import * as crypto from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { range } from 'lodash';
import Bottleneck from 'bottleneck';
import {
  checkSshSanity,
  doTimeout,
  getGcpCredentials,
  getIntegrationInfo,
  getPostgresDatabase,
  getStressTestConfig,
  pluralString,
  processSpawn,
  refreshConfigJson,
  refreshSecrets,
  removeAirnode,
  setPriority,
} from './utils';
import { cliPrint, runAndHandleErrors } from './cli';
import { sendToDB } from './database';
import { deployContractAndCreateRequests, doHardHatMine, getProvider } from './chain';
import { OutputMetrics, RequestSet, RunDependencies } from './types';
import { appendMetrics } from './metrics-file-output';
import { collectMetrics } from './metrics-utils';

process.env.AWS_SDK_LOAD_CONFIG = String(true);

const doSubTestRun = async (runProps: RunDependencies): Promise<OutputMetrics> => {
  if (runProps.requestSets.length === 0) {
    cliPrint.error(`RequestSet array length is 0`);
    return { metrics: [], success: false };
  }
  const { config } = runProps;
  const { requestCount, walletCount, chainCount } = runProps.requestSets[0];
  const { testType, runRepeats, sshConfig, infuraProviderAirnodeOverrideURL } = config;
  const { sshRemoteHost, sshUser, sshPort, sshKeyPath, yamlPath } = sshConfig;

  const mockedRPC = testType === 'MockedProvider';
  const ropstenProvider = testType === 'RopstenProvider';
  const restartServices = !(ropstenProvider || mockedRPC);

  cliPrint.info(
    `Doing ${requestCount} request${pluralString(requestCount)} with ${walletCount} wallet` +
      `${pluralString(walletCount)} against ` +
      `${chainCount} chain${pluralString(chainCount)} a total of ` +
      `${runRepeats} time${pluralString(runRepeats)}...`
  );

  // Remove airnode - this tends to fail often, so we do it multiple times for safety.
  await removeAirnode().catch();

  if (restartServices) {
    cliPrint.info('Restarting services...');

    if (sshRemoteHost === 'local') {
      await processSpawn(
        `bash -c 'docker stack rm services || true; sleep 10; docker stack deploy ` +
          `-c ${join(__dirname, '../docker-compose.yml')} services'`,
        'Initialise Services'
      ).catch((err) => {
        console.trace('Failed to restart services: ', err);
      });
    } else {
      await processSpawn(
        `ssh -o UserKnownHostsFile=/dev/null ` +
          `-o StrictHostKeyChecking=no -i ${sshKeyPath} -p ${sshPort} ` +
          `${sshUser}@${sshRemoteHost} ` +
          `'docker stack rm services || true; sleep 10; docker stack deploy -c ${yamlPath} services || true; sleep 20;'`,
        'Initialise Services'
      ).catch((err) => {
        console.trace('Failed to restart services - aborting this run: ', err);
      });
    }

    await doTimeout(20000);
    cliPrint.info('Services restarted, now initialising chain services...');
  }

  const provider = getProvider(getIntegrationInfo());
  if (testType === 'HardHatProvider') {
    provider.send('evm_setAutomine', [false]).catch((e) => {
      console.trace('Setting automine failed', e);
    });
    // disables mining - you have to manually mine a block
    provider.send('evm_setIntervalMining', [0]).catch((e) => {
      console.trace('Setting interval failed', e);
    });
  }

  if (testType === 'HardHatProvider') {
    await doHardHatMine(provider, testType);

    // turn on interval mining again
    await provider.send('evm_setIntervalMining', [15000]).catch((e) => {
      console.trace('Setting interval to 5000ms failed', e);
    });
    provider.send('hardhat_setLoggingEnabled', [true]).catch(() => {});
  }

  const limit = new Bottleneck({
    maxConcurrent: 1,
  });

  const rrps = await Promise.all(
    range(chainCount).map(async (_, idx) =>
      limit.schedule(() => deployContractAndCreateRequests({ chainNumber: idx, provider, config, walletCount }))
    )
  );

  cliPrint.info('Requests submitted to network, waiting for them to be mined.');
  const configPayload = await refreshConfigJson(rrps);
  const { stage } = configPayload.nodeSettings;

  await doTimeout(10000);
  cliPrint.info('Done waiting for requests to be mined.');
  cliPrint.info('Deploying Airnode to AWS...');
  await refreshSecrets(requestCount);
  const secretsFilePath = join(__dirname, '../aws.env');

  const [gcpCredsMount, gcpCredsEnv] = getGcpCredentials();

  const deployCommand = [
    `docker run -i --rm`,
    `--env-file ${secretsFilePath}`,
    gcpCredsEnv,
    gcpCredsMount,
    `-e USER_ID=$(id -u) -e GROUP_ID=$(id -g)`,
    `-v ${join(__dirname, '../')}:/app/config`,
    `-v ${join(__dirname, '..')}:/app/output`,
    `api3/airnode-deployer:latest deploy`,
    '--debug',
  ].join(' ');
  cliPrint.info(deployCommand);

  await refreshSecrets(requestCount, infuraProviderAirnodeOverrideURL);
  try {
    await processSpawn(deployCommand, 'Deploy Airnode', 'Failed');
  } catch (e) {
    console.trace(e);
    cliPrint.info('Failed to deploy Airnode, trying to remove it first.');
    await removeAirnode();
    try {
      await processSpawn(deployCommand, 'Deploy Airnode', 'Failed again (inside catch)');
    } catch (e) {
      console.trace(e);
      cliPrint.info('Tried twice to deploy Airnode but both attempts failed, quitting...');
      process.exit(1);
    }
  }
  await refreshSecrets(requestCount);

  const collectedMetrics = await collectMetrics(stage, rrps);
  cliPrint.info(`Collected metrics: ${JSON.stringify(collectedMetrics, null, 2)}`);

  return collectedMetrics;
};

const doTestRun = async (runProps: RunDependencies) => {
  const { jsonOutputConfig } = runProps.config;
  const { testKey, tries } = runProps;

  if (runProps.requestSets.length === 0) {
    return { success: false, tries: tries - 1 };
  }
  const { requestCount, walletCount, chainCount } = runProps.requestSets[0];

  const runStart = Date.now();
  const runMetrics = await doSubTestRun(runProps);
  const runEnd = Date.now();

  const outputMetrics = {
    ...runMetrics,
    ...{
      runStart,
      runEnd,
      runDelta: runEnd - runStart,
      requestCount,
      walletCount,
      chainCount,
    },
    testKey,
  };

  appendMetrics(jsonOutputConfig, outputMetrics, runProps.config);
  if (runProps.db) {
    await sendToDB(runProps.db, outputMetrics, runProps.config);
  }

  return { success: runMetrics?.success, requestCount, tries: tries - 1 };
};

const doTestRunSet = async (runProps: RunDependencies) => {
  const { config, requestSets } = runProps;
  const runResults = new Array<RequestSet>();

  for (let i = 0; i < requestSets.length; i++) {
    for (let k = 0; k < config.runRepeats; k++) {
      for (let j = 3; j > 0; j--) {
        const { success } = await doTestRun({
          ...runProps,
          requestSets: [requestSets[i]],
          tries: 1,
        });
        if (success) {
          runResults.push(config.testRuns[i]);
          break;
        }
      }
    }
  }

  return runResults;
};

const main = async () => {
  const config = getStressTestConfig();
  checkSshSanity(config);

  const testKey = crypto.randomUUID();
  const db = getPostgresDatabase(config);

  await refreshSecrets();
  await refreshConfigJson([]); // for code that requires the endpointId

  if (!existsSync(join(__dirname, 'artifacts/contracts/Requestor.sol'))) {
    cliPrint.info('Ask HardHat to compile contracts.');
    await processSpawn('yarn hardhat compile', 'HardHat Compile');
  }

  const runDependencies = { config, db, testKey, tries: 1, requestSets: config.testRuns };
  const runResults = await doTestRunSet(runDependencies);
  const missingResults = config.testRuns.filter((x) => !runResults.includes(x));
  if (missingResults.length > 0) {
    cliPrint.info(`Rerun: Unfortunately the following runs failed and will be retried: ${missingResults}`);
  }
  await doTestRunSet({ ...runDependencies, requestSets: missingResults });

  cliPrint.info('Cleaning up - removing Airnode deployment...');
  await removeAirnode();
};

setPriority();
runAndHandleErrors(main);
