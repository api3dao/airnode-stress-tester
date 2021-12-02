import path, { join } from 'path';
import * as os from 'os';
import { readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { Worker } from 'worker_threads';
import { parse as parseEnvFile } from 'dotenv';
import { ContractsAndRequestsConfig, IntegrationInfo, StressTestConfig } from './types';
import { generateConfigJson } from './config_utils';
import { cliPrint } from './cli';
import { getAirnodeWalletMnemonic } from './chain';
import {DEFAULT_CHAIN_ID} from "./constants";

export const getGcpCredentials = () => {
  const stressTestConfig = getStressTestConfig();
  if (stressTestConfig.CloudProvider.name === 'gcp') {
    return [
      ` -v ${path.join(os.homedir(), '/.config/gcloud/application_default_credentials.json:/application_default_credentials.json')} `,
      ' -e "GOOGLE_APPLICATION_CREDENTIALS=/application_default_credentials.json" '
    ];
  }

  return [' ', ' '];
};


/**
 * @returns a provider URL based on the stress test config dictionary and optionally a request count (only applicable
 * to the fully mocker EVM RPC endpoint).
 *
 * @param stressTestConfig The current stress test config
 * @param requestCount The number of requests the endpoint will return for getLogs, optional
 */
export const getConfiguredProviderURL = (stressTestConfig: StressTestConfig, requestCount?: number) => {
  switch (stressTestConfig.TestType) {
    case 'MockedProvider':
      return `https://mockedrpc.api3mock.link/${requestCount ? requestCount : 100}/`;
    case 'OpenEthereumProvider':
      return 'https://openethereum.api3mock.link';
    case 'HardHatProvider':
      return 'https://hardhat.api3mock.link';
    case 'RopstenProvider':
      return stressTestConfig.InfuraProviderURL;
    default: //not possible
  }
};

/**
 * Checks if one string can be found in another.
 *
 * @param a The parent string
 * @param b The substring
 */
export const contains = (a?: string, b?: string): boolean => {
  if (!a || !b) {
    return false;
  }

  return a.indexOf(b) > -1;
};

/**
 * @returns Integration Info as a dictionary.
 */
export const getIntegrationInfo = (): IntegrationInfo => {
  const stressTestConfig = getStressTestConfig();
  const integrationConfig = {
    integration: 'coingecko-testable',
    airnodeType: 'local',
    network: 'docker-poa-network',
    mnemonic: stressTestConfig.MasterWalletOverrideMnemonic
      ? stressTestConfig.MasterWalletOverrideMnemonic
      : 'test test test test test test test test test test test junk',
    providerUrl: getConfiguredProviderURL(stressTestConfig),
  } as IntegrationInfo;

  return integrationConfig;
};

/**
 * @returns The contents of the "aws.env" file (throws if it doesn't exist)
 */
export const readAwsSecrets = () => parseEnvFile(readFileSync(join(__dirname, '../aws.env')));

/**
 * @returns The contents of the "secrets.env" file for the current integration (throws if it doesn't exist)
 */
export const readAirnodeSecrets = () => {
  const integrationInfo = getIntegrationInfo();

  return parseEnvFile(readFileSync(join(__dirname, `../integrations/${integrationInfo.integration}/secrets.env`)));
};

/**
 * @returns The contents of the "config.json" file for the current integration (throws if it doesn't exist)
 */
export const readConfig = () => {
  const integrationInfo = getIntegrationInfo();

  const config = JSON.parse(
    readFileSync(join(__dirname, `../integrations/${integrationInfo.integration}/config.json`)).toString()
  );
  return config;
};

/**
 * @param secrets The lines of the secrets file
 * @returns All the lines joined followed by a new line symbol
 */
export const formatSecrets = (secrets: string[]) => secrets.join('\n') + '\n';

/**
 * @param filename
 * @returns The "filename" with the last extension removed
 */
export const removeExtension = (filename: string) => filename.split('.')[0];

/**
 * Convenience function to set up a timeout.
 */
export const doTimeout = (interval: number) => new Promise((resolve) => setTimeout(() => resolve(null), interval));

/**
 * @returns the current stress test config
 */
export const getStressTestConfig = () =>
  JSON.parse(readFileSync(join(__dirname, '../stressconfig.json')).toString()) as StressTestConfig;

/**
 * Given a list of Rrp dictionaries this function builds and write a matching config.json file - which the Airnode
 * Deployer can use to deploy Airnode to AWS.
 *
 * @param rrps A list of Rrp deployments for simulating multiple chains
 */
export const refreshConfigJson = async (rrps: ContractsAndRequestsConfig[]) => {
  const config = join(__dirname, `../config.json`);
  const configPayload = generateConfigJson(rrps);
  try {
    await processSpawn(`rm -f ${config}`, `Remove ${config}`);
    writeFileSync(config, JSON.stringify(configPayload, null, 2));
  } catch (e) {
    console.trace(e);
    cliPrint.error(`Failed to write airnode ${config} file.`);
  }
};

/**
 * Spawns a process and redirects stdout and stderr to the parent process's tty.
 * It also watches those pipes for `watchDeadText`; some processes don't exit with an error code (>0) when they fail
 * (like the docker deployer), so we watch for text that indicates failure so we can retry if necessary.
 */
export const processSpawn = async (
  command: string,
  prefix: string,
  watchDeathText?: string,
  watchOkayText?: string
) => {
  const sshProcess = spawn('bash', ['-c', command]);

  // await (async () => {
  return new Promise((resolve, reject) => {
    sshProcess.once('close', (code) => {
      cliPrint.info(`${prefix} :child process exited with code ${code}`);
      if (code === 0) {
        resolve(code);
      }

      reject(code);
    });

    sshProcess.once('error', (error) => {
      printLines(error.message, prefix + '-ERROR');
      reject(error);
    });

    const checkDeathText = (data: string) => {
      if (watchDeathText) {
        if (data.indexOf(watchDeathText) > -1) {
          if (!watchOkayText) {
            reject(data);
          } else if (data.indexOf(watchOkayText) < 0) {
            reject(data);
          }
        }
      }
    };

    sshProcess.stdout.on('data', (data) => {
      printLines(data, prefix);
      checkDeathText(String(data));
    });

    sshProcess.stderr.on('data', (data) => {
      printLines(data, prefix + '-stderr');
      checkDeathText(String(data));
    });
  });
};

/**
 * Neatly prints lines from child_processes.
 *
 * @param lines A string potentially containing multiple lines delimited by /n
 * @param prefix A string the lines will be prefixed with when printed to the console.
 */
export const printLines = (lines: string, prefix: string) => {
  try {
    const safeLines = '' + lines;
    safeLines.split('\n').forEach((line) => cliPrint.info(`${prefix} : ${line}`));
  } catch (e) {
    cliPrint.info(`${prefix} : ${lines}`);
  }
};

/**
 * Airnode aggregates requests with the same parameters. Our API is mocked, so we pack the request parameter with a
 * random string so that Airnode always processes all our requests.
 *
 * @param length The length the returned random string should be
 * @returns randomString A random string
 *
 */
export const generateRandomString = (length: number) => {
  let randomString = '';
  for (let i = 0; i < 10; i++) {
    randomString += (Math.random() + 1).toString(36).substring(2).toLowerCase();
  }

  const targetLength = length > randomString.length ? randomString.length - 1 : length;

  return randomString.substring(0, targetLength);
};

/**
 * A convenience method for deterimining the addition of an 's' for pluralising number-descriptive text.
 *
 * @param input The number to asses
 */
export const pluralString = (input: number) => (input === 1 ? '' : 's');

/**
 * Refreshes the secrets.env file - for use with the Airnode Deployer.
 *
 * @param requestCount An optional paramater representing the request count, which informs the Mocked RPC Provider
 * @param providerOverride an optional provider override URL
 */
export const refreshSecrets = async (requestCount?: number, providerOverride?: string) => {
  const {ChainId} = getStressTestConfig();
  const providerUrl = providerOverride ?
      providerOverride : getConfiguredProviderURL(getStressTestConfig(), requestCount);

  //https://mitm-hardhat.api3mock.link
  const airnodeSecrets = `PROVIDER_URL=${providerUrl}
AIRNODE_WALLET_MNEMONIC=${getAirnodeWalletMnemonic()}
AIRNODE_RRP_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
CHAIN_ID=${ChainId ? ChainId : DEFAULT_CHAIN_ID}
CLOUD_PROVIDER_TYPE=local
HTTP_GATEWAY_API_KEY=${randomUUID()}
`;
  try {
    const secretsPath = join(__dirname, '../secrets.env');
    await processSpawn(`rm -f ${secretsPath}`, `Remove secrets.env`);
    writeFileSync(secretsPath, airnodeSecrets);
  } catch (e) {
    console.trace(e);
    cliPrint.error('Failed to write airnode secrets env file.');
  }
};

/**
 * During high work loads this application can slow down a host machine considerably. This function tries to set the
 * process priority so the host machine can be used for other tasks while the tests run in the background.
 */
export const setPriority = () => {
  try {
    // Low priority
    os.setPriority(18);
  } catch (e) {
    //do nothing
  }
};

/**
 * Uses the Airnode Deployer to try and remove an Airnode instance from AWS.
 */
export const removeAirnode = async () => {
  await refreshSecrets();
  const integrationPath = join(__dirname, '../integration-info.json');
  writeFileSync(integrationPath, JSON.stringify(getIntegrationInfo()));
  const secretsFilePath = join(__dirname, '../aws.env');
  const [gcpCredsMount, gcpCredsEnv ] = getGcpCredentials();

  const deployCommand = [
    `docker run -i --rm`,
    `--env-file ${secretsFilePath}`,
    `-e USER_ID=$(id -u) -e GROUP_ID=$(id -g)`,
    gcpCredsEnv,
    gcpCredsMount,
    `-v ${join(__dirname, '../')}:/app/output`,
    `api3/airnode-deployer:latest remove -r output/receipt.json --debug`,
  ].join(' ');
  console.log(deployCommand);

  cliPrint.info(deployCommand);
  // runShellCommand(deployCommand);
  return processSpawn(deployCommand, 'Remove Airnode', 'Error', 'S3 bucket does not exist').catch(() => {
    cliPrint.warning('Failed to remove Airnode, trying again.');
    processSpawn(deployCommand, 'Remove Airnode', 'Error').catch(() => {});
  });
};
