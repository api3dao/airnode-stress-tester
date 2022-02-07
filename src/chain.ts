import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { ethers, Wallet } from 'ethers';
import { encode } from '@api3/airnode-abi';
import { NonceManager } from '@ethersproject/experimental';
import { formatEther, parseEther } from 'ethers/lib/utils';
import Bottleneck from 'bottleneck';
import { range } from 'lodash';
import { AirnodeRrp } from '@api3/airnode-protocol';
import { deriveAirnodeXpub, deriveSponsorWalletAddress } from '@api3/airnode-admin';
import { ContractsAndRequestsProps, IntegrationInfo, TestType } from './types';
import { getIntegrationInfo, getMaxBatchSize, removeExtension } from './utils';
import { cliPrint } from './cli';
import { generateConfigJson } from './config-utils';

export const deploymentPath = join(__dirname, '../docker-poa-network.json');

/**
 * A convenience function that calls a special RPC function to make HardHat mine a block.
 *
 * @param provider an EVM provider
 * @param testType testType is a TestType
 */
export const doHardHatMine = async (provider: ethers.providers.JsonRpcProvider, testType: TestType) => {
  if (testType === 'HardHatProvider') {
    await provider.send('evm_mine', []).catch((e) => {
      console.trace('Mine block failed', e);
    });
  }
};

/**
 * RetryingProvider retries every call that goes through it.
 *
 * The stress tester has to set up chain services that often require several hundred EVM calls. To speed up these calls
 * they are done in parallel, but this places a lot of strain on the EVM node and the network. Sometimes (~1%) of calls
 * fail and this can be very problematic. To avoid having complex fault-handling logic further up the stack, this class
 * retries every request on failure, up to a maximum of 5 attempts.
 *
 * This has the effect of making chain set up very reliable, even when doing batches of 100 calls concurrently and that
 * means chain set up is now _very_ fast.
 */
export class RetryingProvider extends ethers.providers.JsonRpcProvider {
  constructor(url: string) {
    super(url);
  }

  async send(method: string, params: Array<any>): Promise<any> {
    let tries = 0;
    const maxTries = 5;
    do {
      try {
        if (tries > 0) {
          console.log(`Try ${tries} of ${maxTries}`);
        }
        tries++;
        return await super.send(method, params);
      } catch (e) {
        console.trace(e);
      }
    } while (tries < maxTries);

    return null;
  }
}

/**
 * @returns a provider URL
 * @param integrationInfo The integration info
 */
export const getProvider = (integrationInfo: IntegrationInfo) => {
  return new RetryingProvider(integrationInfo.providerUrl);
};

/**
 * @returns the default user wallet
 * @param integrationInfo The integration info
 */
export const getUserWallet = (integrationInfo: IntegrationInfo) =>
  ethers.Wallet.fromMnemonic(integrationInfo.mnemonic).connect(getProvider(integrationInfo));

/**
 * @returns mnemonic A hard-coded Airnode wallet mnemonic
 */
export const getAirnodeWalletMnemonic = () =>
  `skate viable exhibit general garment shrug enough crucial oblige victory ritual fringe`;

/**
 * @returns Wallet A Wallet object for the hard-coded Airnode wallet
 */
export const getAirnodeWallet = () => ethers.Wallet.fromMnemonic(getAirnodeWalletMnemonic());

/**
 * @returns artifact A contract artifact
 * @param artifactsFolderPath
 */
export const getArtifact = (artifactsFolderPath: string) => {
  const fullArtifactsPath = join(__dirname, '../artifacts/', artifactsFolderPath);
  const files = readdirSync(fullArtifactsPath);
  const artifactName = files.find((f) => !f.endsWith('.dbg.json'))!;
  const artifactPath = join(fullArtifactsPath, artifactName);
  return require(artifactPath);
};

export const deployContractAndCreateRequests = async ({
  chainNumber,
  config,
  provider,
  walletCount,
}: ContractsAndRequestsProps) => {
  const maxBatchSize = getMaxBatchSize(config);
  const { testType } = config;
  const limit = new Bottleneck({
    maxConcurrent: maxBatchSize,
  });
  const endpointId = generateConfigJson([]).triggers.rrp[0].endpointId;

  await doHardHatMine(provider, testType);

  const airnodeRrp = await deployContract(
    getIntegrationInfo(),
    '@api3/airnode-protocol/contracts/rrp/AirnodeRrp.sol',
    chainNumber
  );
  cliPrint.info(`AirnodeRrp deployed to address: ${airnodeRrp.address}`);

  const airnodeWallet = getAirnodeWallet().connect(provider);
  const masterSponsor = ethers.Wallet.fromMnemonic(getIntegrationInfo().mnemonic).connect(provider);
  const nMSponsor = new NonceManager(masterSponsor);

  const requester = await deployContract(
    getIntegrationInfo(),
    `contracts/Requester.sol`,
    chainNumber,
    [airnodeRrp.address],
    nMSponsor
  );
  const USE_SAME_SPONSOR = false;

  const airnodeHdNode = ethers.utils.HDNode.fromMnemonic(airnodeWallet.mnemonic.phrase);

  const receiptPromises = range(walletCount)
    .map((_, idx) => {
      if (USE_SAME_SPONSOR) {
        return masterSponsor;
      }

      // it's useful to make wallets predictable for doing live tests (so we don't have to keep funding wallets)
      return new Wallet(airnodeHdNode.derivePath(`m/48'/60'/0'/0/${idx}`)).connect(provider);
    })
    .map((sponsor) => {
      // Sometimes HardHat dies due to the load, in this case we slow things down using Bottleneck
      const chainSetupFunction = async (sponsor: Wallet) => {
        try {
          const sponsorWalletAddress = await deriveSponsorWalletAddress(
            deriveAirnodeXpub(airnodeWallet.mnemonic.phrase),
            airnodeWallet.address,
            sponsor.address
          );
          cliPrint.info(`Derived Sponsor Wallet Address ${sponsorWalletAddress}`);
          // Fund the sponsor wallet
          await fundAWallet(provider, nMSponsor, sponsorWalletAddress);
          await doHardHatMine(provider, testType);

          await fundAWallet(provider, nMSponsor, sponsor.address);
          await doHardHatMine(provider, testType);

          const airnodeRrpWithSigner = airnodeRrp.connect(sponsor.connect(provider)) as AirnodeRrp;
          cliPrint.info(`Sponsoring requester...`);

          const tx3 = await airnodeRrpWithSigner.setSponsorshipStatus(requester.address, true);
          await doHardHatMine(provider, testType);
          await tx3.wait(1);

          // Trigger the Airnode request
          cliPrint.info(`Making a request to sponsor wallet: ${sponsorWalletAddress}`);
          const receipt = await requester.makeRequest(
            airnodeWallet.address,
            endpointId,
            sponsor.address,
            sponsorWalletAddress,
            getEncodedParameters()
          );
          cliPrint.info(`Made request, receipt: ${receipt.hash}`);

          return {
            receipt,
            sponsorWalletAddress,
            sponsorAddress: sponsor.address,
          };
        } catch (e) {
          console.trace(e);
        }
      };

      return limit.schedule(() => chainSetupFunction(sponsor));
    });
  cliPrint.info('Waiting for receipts to resolve...');
  await Promise.all(receiptPromises);
  cliPrint.info('receipts resolved.');
  cliPrint.info('Done initialising chain services, moving on to executing requests...');

  // mine all the transactions
  await doHardHatMine(provider, testType);

  return airnodeRrp.address;
};

/**
 * @returns encodedParams airnode-abi encoded parameters
 */
export const getEncodedParameters = () => encode([]);

/**
 * Deploys the contract specified by the path to the artifact and constructor arguments. This method will also write the
 * address of the deployed contract which can be used to connect to the contract.
 *
 * @param integrationInfo
 * @param artifactsFolderPath
 * @param args Arguments for the contract constructor to be deployed
 * @param deploymentNumber
 * @param wallet
 * @returns The deployed contract
 */
export const deployContract = async (
  integrationInfo: IntegrationInfo,
  artifactsFolderPath: string,
  deploymentNumber = 0,
  args: any[] = [],
  wallet?: ethers.Wallet | NonceManager
) => {
  const artifact = getArtifact(artifactsFolderPath);

  // Deploy the contract
  const contractFactory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet ? wallet : await getUserWallet(integrationInfo)
  );
  const contract = await contractFactory.deploy(...args);
  await contract.deployed();

  // Make sure the deployments folder exist
  const deploymentsPath = join(__dirname, '../deployments');
  if (!existsSync(deploymentsPath)) mkdirSync(deploymentsPath);

  const deployment = (() => {
    if (existsSync(deploymentPath)) {
      return JSON.parse(readFileSync(deploymentPath).toString());
    }

    return {};
  })();

  // The key name for this contract is the path of the artifact without the '.sol' extension
  const deploymentName = removeExtension(artifactsFolderPath);
  const deploymentArray = deployment[deploymentName] ? deployment[deploymentName] : [];
  deploymentArray[deploymentNumber] = contract.address;

  writeFileSync(deploymentPath, JSON.stringify({ ...deployment, [deploymentName]: deploymentArray }, null, 2));

  return contract;
};

export const readChainId = async (integrationInfo: IntegrationInfo) =>
  (await getProvider(integrationInfo).getNetwork()).chainId;

/**
 * Checks an EVM address to determine if it has less than `lowThreshold` funds and if it does, it uses the `sourceWallet`
 * to send funds to the `destinationAddress`. It is useful for on-chain tests where re-producible wallets are used so
 * that less testnet tokens are required.
 *
 * @param provider an EVM provider
 * @param sourceWallet the source wallet from which to send funds
 * @param destinationAddress the destination address
 * @param lowThreshold if the `destinationAddress` has less funds than this `amountToSend` will be sent
 * @param amountToSend the amount to send to the `destinationAddress`
 */
export const fundAWallet = async (
  provider: ethers.providers.JsonRpcProvider,
  sourceWallet: Wallet | NonceManager,
  destinationAddress: string,
  lowThreshold = parseEther('0.005'),
  amountToSend = parseEther('0.01')
) => {
  const balance = await sourceWallet.getBalance();
  if (balance.lt(amountToSend))
    throw new Error(`Sponsor account (${(sourceWallet as Wallet).address}) doesn't have enough funds!`);

  const destinationBalance = await provider.getBalance(destinationAddress);
  if (destinationBalance.gt(lowThreshold)) {
    cliPrint.info(
      `Destination wallet ${destinationAddress} has sufficient funds, so we won't send funds: ${formatEther(
        destinationBalance
      )} ETH`
    );
    return;
  }

  cliPrint.info(
    `Destination wallet ${destinationAddress} has less funds than threshold, so we will transfer funds to it: ${formatEther(
      destinationBalance
    )} ETH`
  );
  cliPrint.info(`Sending funds...`);
  const tx = await sourceWallet.sendTransaction({ to: destinationAddress, value: amountToSend });
  cliPrint.info('Waiting on confirmation');
  await tx.wait(1);
  cliPrint.info(`Successfully sent funds to sponsor wallet address: ${destinationAddress}.`);
  const destinationBalanceAfterTx = ethers.utils.formatEther(await provider.getBalance(destinationAddress));
  cliPrint.info(`Current balance: ${destinationBalanceAfterTx}`);
};
