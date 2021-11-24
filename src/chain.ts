import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { ethers } from 'ethers';
import { encode } from '@api3/airnode-abi';
import { ContractsAndRequestsConfig, IntegrationInfo } from './types';
import { deriveAirnodeXpub, deriveSponsorWalletAddress } from './evm';
import { generateRandomString, removeExtension } from './utils';
import { cliPrint } from './cli';

export const deploymentPath = join(__dirname, '../docker-poa-network.json');

/**
 * @returns a provider URL
 * @param integrationInfo The integration info
 */
export const getProvider = (integrationInfo: IntegrationInfo) =>
  new ethers.providers.JsonRpcProvider(integrationInfo.providerUrl);

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

/**
 * @returns encodedParams airnode-abi encoded parameters
 * @param coin
 */
export const getEncodedParameters = (coin: string) => encode([{ name: 'coinId', type: 'bytes32', value: coin }]);

/**
 * Executes a request against a set of services represented by the arguments.
 * Nonce sequencing is necessary to avoid overlapping transactions.
 * This call can take a long time, so execution is divved up over multiple Node WORKERs.
 *
 * @param confData An airnodeRrp deployment dictionary
 * @param integrationInfo Integration Info
 * @param nonce We sequence the nonces so we can queue up multiple transactions per block/
 * @param RandomLength The length of the random string sent as a parameter in the request.
 * @param mnemonic The sponsor wallet mnemonic
 * @param deploymentNumber The AirnodeRrp deployment index - used to get artifacts
 */
export const makeRequest = async (
  confData: ContractsAndRequestsConfig,
  integrationInfo: IntegrationInfo,
  nonce: Number,
  RandomLength: number,
  mnemonic?: string,
  deploymentNumber?: number
) => {
  const overrideOptions = { nonce: nonce };
  const airnodeWallet = ethers.Wallet.fromMnemonic(confData.AirnodeMnemonic);
  const sponsor = ethers.Wallet.fromMnemonic(mnemonic ? mnemonic : integrationInfo.mnemonic);

  const requester = await getDeployedContract(
    integrationInfo,
    `contracts/Requester.sol`,
    deploymentNumber,
    sponsor.mnemonic.phrase
  );
  const endpointId = JSON.parse(readFileSync(join(__dirname, `../config.json`)).toString()).triggers.rrp[0].endpointId;

  const sponsorWalletAddress = await deriveSponsorWalletAddress(
    deriveAirnodeXpub(airnodeWallet.mnemonic.phrase),
    airnodeWallet.address,
    sponsor.address
  );

  cliPrint.info(
    `Make request parameters
    ${JSON.stringify(
      {
        'airnode wallet address': airnodeWallet.address,
        'Endpoint ID': endpointId,
        'Sponsor address': sponsor.address,
        'Sponsor wallet address': sponsorWalletAddress,
        'Encoded parameters': getEncodedParameters(generateRandomString(RandomLength)),
        overrideOptions,
      },
      null,
      2
    )}`
  );

  try {
    await requester.makeRequest(
      airnodeWallet.address,
      endpointId,
      sponsor.address,
      sponsorWalletAddress,
      getEncodedParameters(generateRandomString(RandomLength)),
      overrideOptions
    );
    cliPrint.info(
      `Transaction successful: Sponsor (${sponsor.address} ${sponsorWalletAddress}) ` +
        `Requester (${requester.address})`
    );
  } catch (e) {
    console.trace('Make Request failed', e);
  }
};

/**
 * Deploys the contract specified by the path to the artifact and constructor arguments. This method will also write the
 * address of the deployed contract which can be used to connect to the contract.
 *
 * @param integrationInfo
 * @param artifactsFolderPath
 * @param args Arguments for the contract constructor to be deployed
 * @param deploymentNumber
 * @returns The deployed contract
 */
export const deployContract = async (
  integrationInfo: IntegrationInfo,
  artifactsFolderPath: string,
  deploymentNumber = 0,
  args: any[] = []
) => {
  const artifact = getArtifact(artifactsFolderPath);

  // Deploy the contract
  const contractFactory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    await getUserWallet(integrationInfo)
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

/**
 * Connect to the already deployed contract specified by the path to the compiled contract artifact.
 *
 * @param integrationInfo
 * @param artifactsFolderPath
 * @param deploymentNumber
 * @param userWalletMnemonic
 * @returns The deployed contract
 */
export const getDeployedContract = async (
  integrationInfo: IntegrationInfo,
  artifactsFolderPath: string,
  deploymentNumber = 0,
  userWalletMnemonic?: string
) => {
  const userWallet = await (async () => {
    if (userWalletMnemonic) {
      return ethers.Wallet.fromMnemonic(userWalletMnemonic).connect(getProvider(integrationInfo));
    }

    return getUserWallet(integrationInfo);
  })();

  const artifact = getArtifact(artifactsFolderPath);

  const deploymentsPath = join(__dirname, '../deployments');
  if (!existsSync(deploymentsPath)) mkdirSync(deploymentsPath);

  const deployment = (() => {
    if (existsSync(deploymentPath)) {
      return JSON.parse(readFileSync(deploymentPath).toString());
    }

    return {};
  })();
  const deploymentName = removeExtension(artifactsFolderPath);

  return new ethers.Contract(deployment[deploymentName][deploymentNumber], artifact.abi, userWallet);
};
export const readChainId = async (integrationInfo: IntegrationInfo) =>
  (await getProvider(integrationInfo).getNetwork()).chainId;
