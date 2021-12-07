import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { ethers } from 'ethers';
import { encode } from '@api3/airnode-abi';
import { NonceManager } from '@ethersproject/experimental';
import { IntegrationInfo } from './types';
import { removeExtension } from './utils';

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
