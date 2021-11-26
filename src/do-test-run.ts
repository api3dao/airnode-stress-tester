import * as crypto from 'crypto';
import { isMainThread, parentPort } from 'worker_threads';
import { existsSync } from 'fs';
import path, { join } from 'path';
import * as os from 'os';
import { ethers } from 'ethers';
import * as admin from '@api3/airnode-admin/dist/src/implementation';
import { AirnodeRrp } from '@api3/airnode-protocol';
import { range } from 'lodash';
import {
  runAndHandleErrors,
  cliPrint,
  sendToDB,
  initDB,
  deriveSponsorWalletAddress,
  deriveAirnodeXpub,
  RequestSet,
  ContractsAndRequestsConfig,
  doTimeout,
  getStressTestConfig,
  getProvider,
  processSpawn,
  refreshConfigJson,
  getAirnodeWallet,
  pluralString,
  makeRequest,
  contains,
  appendMetrics,
  collectMetrics,
  deployContract,
  getIntegrationInfo,
  refreshSecrets,
  makeMessage,
  Messages,
  removeAirnode,
  generateConfigJson, 
  getEncodedParameters, 
  generateRandomString,
  getGcpCredentials
} from './';

process.env.AWS_SDK_LOAD_CONFIG = String(true);
process.setMaxListeners(2000);

/**
 * During high work loads this application can slow down a host machine considerably. This function tries to set the
 * process priority so the host machine can be used for other tasks while the tests run in the background.
 */
const setPriority = () => {
  try {
    // Low priority
    os.setPriority(18);
  } catch (e) {
    //do nothing
  }
};

/*
export const getGcpCredentials = () => {
  const stressTestConfig = getStressTestConfig();
  if (stressTestConfig.CloudProvider.name === 'gcp') {
    return [
      ` -v ${path.join(os.homedir(), '/.config/gcloud/application_default_credentials.json:/application_default_credentials.json')} `,
      ' -e "GOOGLE_APPLICATION_CREDENTIALS=/application_default_credentials.json" '
    ];
  }

  return [' ', ' '];
};*/

/**
 * The main function acts as the parent process in the multi-threaded cluster.
 * This function only executed if isMainThread is true.
 */
const main = async () => {
  await removeAirnode();
  await doTimeout(10000);
  const stressTestConfig = getStressTestConfig();

  const {
    TestRuns,
    RunRepeats,
    PostgresConfig,
    JsonOutputConfig,
    SshConfig,
    TestType,
    InfuraProviderAirnodeOverrideURL,
  } = getStressTestConfig();
  const { SshKeyPath, SshRemoteHost, SshUser, SshPort, YamlPath } = SshConfig;

  if (contains(SshRemoteHost, 'local') && !(SshRemoteHost && SshUser && SshPort && SshKeyPath)) {
    cliPrint.error(
      `You specified an SSH host other than 'local' but one or more of your SSH parameters is either ` +
      `missing or invalid.`,
    );
    process.exit(1);
  }

  const testKey = crypto.randomUUID();
  const mockedRPC = TestType === 'MockedProvider';
  const ropstenProvider = TestType === 'RopstenProvider';
  const restartServices = !(ropstenProvider || mockedRPC);

  await refreshSecrets();
  await refreshConfigJson([]); // for code that requires the endpointId

  if (!existsSync(join(__dirname, 'artifacts/contracts/Requestor.sol'))) {
    cliPrint.info('Ask HardHat to compile contracts.');
    await processSpawn('yarn hardhat compile', 'HardHat Compile');
  }

  // Initialise the database if configured
  const pg = (() => {
    if (PostgresConfig && PostgresConfig.PostgresEnabled) {
      return initDB(PostgresConfig);
    }

    return null;
  })();

  /* TODO This was replaced temporarily to accommodate a rework of the request code so as to remove it as a confounding
  factor in testing. This should be re-enabled at some point as it speeds things up a lot.
  */
  // Initialise the Node workers
  // const workers = os.cpus().map((_cpuInfo, idx) => workerTs(__filename, { workerData: { WorkerNumber: idx } }));
  // cliPrint.info('Workers initialised.');


  const doRun = async ({ RequestCount, WalletCount, ChainCount }: RequestSet, tries: number) => {
    const runStart = Date.now();

    const runMetrics = await (async (): Promise<{ metrics: any; success: boolean }> => {
      cliPrint.info(
        `Doing ${RequestCount} request${pluralString(RequestCount)} with ${WalletCount} wallet` +
        `${pluralString(WalletCount)} against ` +
        `${ChainCount} chain${pluralString(ChainCount)} a total of ` +
        `${RunRepeats} time${pluralString(RunRepeats)}...`,
      );

      // Remove airnode - this tends to fail often, so we do it multiple times for safety.
      await removeAirnode().catch();

      {
        if (restartServices) {
          cliPrint.info('Restarting services...');

          if (SshRemoteHost === 'local') {
            await processSpawn(
              `bash -c 'docker stack rm services || true; sleep 10; docker stack deploy ` +
              `-c ${join(__dirname, '../docker-compose.yml')} services'`,
              'Initialise Services',
            ).catch((err) => {
              console.trace('Failed to restart services: ', err);
            });
          } else {
            await processSpawn(
              `ssh -o UserKnownHostsFile=/dev/null ` +
              `-o StrictHostKeyChecking=no -i ${SshKeyPath} -p ${SshPort} ` +
              `${SshUser}@${SshRemoteHost} ` +
              `'docker stack rm services || true; sleep 10; docker stack deploy -c ${YamlPath} services || true; sleep 20;'`,
              'Initialise Services',
            ).catch((err) => {
              console.trace('Failed to restart services - aborting this run: ', err);
            });
          }

          await doTimeout(20000);
          cliPrint.info('Services restarted, now initialising chain services...');
        }

        const provider = getProvider(getIntegrationInfo());
        if (TestType === 'HardHatProvider') {
          provider.send('evm_setAutomine', [false]).catch((e) => {
            console.trace('Setting automine failed', e);
          });
          // disables mining - you have to manually mine a block
          provider.send('evm_setIntervalMining', [0]).catch((e) => {
            console.trace('Setting interval failed', e);
          });
        }

        const deployContractAndRequests = async (): Promise<ContractsAndRequestsConfig> => {
          if (TestType === 'HardHatProvider') {
            provider.send('evm_mine', []).catch((e) => {
              console.trace('Mine block failed', e);
            });
          }

          const airnodeRrp = await deployContract(
            getIntegrationInfo(),
            '@api3/airnode-protocol/contracts/rrp/AirnodeRrp.sol',
          );
          airnodeRrp.connect(provider);
          cliPrint.info(`AirnodeRrp deployed to address: ${airnodeRrp.address}`);

          const airnodeWallet = getAirnodeWallet();
          airnodeWallet.connect(provider);
          const masterSponsor = ethers.Wallet.fromMnemonic(getIntegrationInfo().mnemonic).connect(provider);
          const requester = await deployContract(getIntegrationInfo(),
              `contracts/Requester.sol`,
              0, [airnodeRrp.address]);
          requester.connect(airnodeWallet);
          requester.connect(provider);
          const USE_SAME_SPONSOR = false;

          // TODO This is slow and can be sped up a lot.
          const sponsors = range(WalletCount).map(() => (USE_SAME_SPONSOR ? masterSponsor : ethers.Wallet.createRandom()));
          for (const sponsor of sponsors) {
            try {
              sponsor.connect(provider);
              const endpointId = generateConfigJson( []).triggers.rrp[0].endpointId;
              const sponsorWalletAddress = await deriveSponsorWalletAddress(
                // NOTE: When doing this manually, you can use the 'derive-airnode-xpub' from the admin CLI package
                deriveAirnodeXpub(airnodeWallet.mnemonic.phrase),
                airnodeWallet.address,
                sponsor.address,
              );
              cliPrint.info(`Derived Sponsor Wallet Address ${sponsorWalletAddress}`);
              // Fund the sponsor wallet
              const tx1 = await masterSponsor.sendTransaction({
                to: sponsorWalletAddress,
                value: ethers.utils.parseEther('0.1'),
              });
              cliPrint.info(`Sent tx to fund sponsor wallet, waiting for tx to be mined...`);
              await tx1.wait();
              cliPrint.info(`Tx mined, moving on to funding sponsor.`);
              // Fund the sponsor
              const tx2 = await masterSponsor.sendTransaction({
                to: sponsor.address,
                value: ethers.utils.parseEther('0.1'),
              });
              cliPrint.info(`Waiting for tx to be mined...`);
              await tx2.wait();

              const moddedarrp = airnodeRrp.
              connect(ethers.Wallet.fromMnemonic(sponsor.mnemonic.phrase).connect(provider)) as AirnodeRrp;
              // Sponsor the requester
              cliPrint.info(`Sponsoring requester...`);
              await admin.sponsorRequester(
                moddedarrp,
                requester.address,
              );
              cliPrint.info(`Done sponsoring requester...`);
              // Trigger the Airnode request
              cliPrint.info(`Making a request to sponsor wallet: ${sponsorWalletAddress}`);
              const receipt = await requester.makeRequest(
                airnodeWallet.address,
                endpointId,
                sponsor.address,
                sponsorWalletAddress,
                getEncodedParameters(generateRandomString(5)),
              );
              cliPrint.info(`Made request, receipt: ${receipt.hash}`);
            } catch (e) {
              console.trace(e);
            }

            // ids.push(
            //   await new Promise<string>((resolve) =>
            //     provider.once(receipt.hash, (tx) => {
            //       const parsedLog = airnodeRrp.interface.parseLog(tx.logs[0]);
            //       resolve(parsedLog.args.requestId);
            //     })
            //   )
            // );
          }
          cliPrint.info('Done initialising chain services, moving on to executing requests...');

          const confData = {
            AirnodeRrpAddress: airnodeRrp.address,
            AirnodeMnemonic: airnodeWallet.mnemonic.phrase,
          };

          // mine all the transactions
          if (TestType === 'HardHatProvider') {
            await provider.send('evm_mine', []).catch((e) => {
              console.trace('Mine block failed', e);
            });
          }

          return confData;
        };

        if (TestType === 'HardHatProvider') {
          // mine all the transactions
          await provider.send('evm_mine', []).catch((e) => {
            console.trace('Mine block failed', e);
          });

          // turn on interval mining again
          await provider.send('evm_setIntervalMining', [15000]).catch((e) => {
            console.trace('Setting interval to 5000ms failed', e);
          });
          provider.send('hardhat_setLoggingEnabled', [true]).catch(() => {
          });
        }

        // I *really* tried to do this functionally, but it can only be done using .map if the underlying nonces are
        // sequenced... and it just seems like a ton of effort that won't add anything here.
        const rrps = Array<ContractsAndRequestsConfig>();
        for (let i = 0; i < ChainCount; i++) {
          rrps.push(await deployContractAndRequests());
        }

        cliPrint.info('Requests submitted to network, waiting for them to be mined.');
        await refreshConfigJson(rrps);

        await doTimeout(10000);
        cliPrint.info('Done waiting for requests to be mined.');
      }

      cliPrint.info('Deploying Airnode ot AWS...');
      await refreshSecrets(RequestCount);
      const secretsFilePath = join(__dirname, '../aws.env');

      const [gcpCredsMount, gcpCredsEnv ] = getGcpCredentials();

      const deployCommand = [
        `docker run -i --rm`,
        `--env-file ${secretsFilePath}`,
          gcpCredsEnv,
        gcpCredsMount,
        `-e USER_ID=$(id -u) -e GROUP_ID=$(id -g)`,
        `-v ${join(__dirname, '../')}:/app/config`,
        `-v ${join(__dirname, '..')}:/app/output`,
        `api3/airnode-deployer:latest deploy`,
      ].join(' ');
	console.log(deployCommand);

      await refreshSecrets(RequestCount, InfuraProviderAirnodeOverrideURL);
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
      await refreshSecrets(RequestCount);

      // Collect metrics
      const collectedMetrics = await collectMetrics();
      cliPrint.info(`Collected metrics: ${JSON.stringify(collectedMetrics, null, 2)}`);

      return collectedMetrics;
    })();

    const runEnd = Date.now();

    const outputMetrics = {
      ...runMetrics,
      ...{
        runStart,
        runEnd,
        runDelta: runEnd - runStart,
        requestCount: RequestCount,
        success: runMetrics?.success,
        walletCount: WalletCount,
        chainCount: ChainCount,
      },
    };

    appendMetrics(JsonOutputConfig, { ...outputMetrics, testKey, TestType });
    await sendToDB(pg, outputMetrics, testKey, stressTestConfig);

    return { success: runMetrics?.success, RequestCount, tries: tries - 1 };
  };

  const doRunSet = async (requestSet: RequestSet[]) => {
    const runResults = new Array<RequestSet>();

    for (let i = 0; i < requestSet.length; i++) {
      for (let k = 0; k < stressTestConfig.RunRepeats; k++) {
        for (let j = 3; j > 0; j--) {
          const { success } = await doRun(requestSet[i], j);
          if (success) {
            runResults.push(TestRuns[i]);
            break;
          }
        }
      }
    }

    return runResults;
  };

  const runResults = await doRunSet(TestRuns);
  const missingResults = TestRuns.filter((x) => !runResults.includes(x));
  if (missingResults.length > 0) {
    cliPrint.info(`Rerun: Unfortunately the following runs failed and will be retried: ${missingResults}`);
  }
  await doRunSet(missingResults);

  cliPrint.info('Cleaning up - removing Airnode deployment...');
  await removeAirnode();
};

/**
 * We make use of Node WORKERs to execute transaction signing and submission. This process appears to be CPU
 * intensive in ethers, so it benefits from being done in a highly concurrent fashion.
 *
 * This subsystem was originally designed with a goal of 1000 requests per cycle.
 *
 * The parent process executes main() and worker processes take the alternative path.
 */
if (isMainThread) {
  setPriority();
  runAndHandleErrors(main);
} else {
  setPriority();
  // workerNumber comes in from init boilerplate
  // @ts-ignore
  if (workerNumber) {
    // @ts-ignore
    cliPrint.info(`Worker Started: ${workerNumber} started.`);
  }

  const { RandomLength } = getStressTestConfig();

  try {
    runAndHandleErrors(async () => {
      return new Promise<void>((resolve, reject) => {
        try {
          if (!parentPort) {
            console.error(`ParentPort is null/undefined, shouldn't be possible.`);
            return;
          }

          parentPort.on(Messages.PING, () => {
            parentPort?.postMessage(Messages.PONG);
          });

          parentPort.once(Messages.WORKER_DO_EXIT, () => {
            parentPort?.postMessage(Messages.WORKER_EXITING);
            resolve();
            process.exit(0);
          });

          parentPort.on('message', async (event_data: any) => {
            switch (event_data?.Action) {
              case Messages.WORKER_DO_WALLET_INIT:
                await (async () => {
                  // TODO make wallet inits concurrent
                })();
                break;
              case Messages.WORKER_DO_REQUEST:
                await (async () => {
                  const { nonce, mnemonic, deploymentNumber, confData } = event_data;
                  const request_receipt = await makeRequest(
                    confData,
                    getIntegrationInfo(),
                    nonce,
                    RandomLength,
                    mnemonic,
                    deploymentNumber,
                  );

                  parentPort?.postMessage(makeMessage(Messages.WORKER_REQUEST_RESPONSE, { receipt: request_receipt }));
                })();
                break;
              default:
            }
          });

          parentPort.once('close', (_event_data: any) => {
            cliPrint.info('Got close message - exiting.');
            resolve();
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  } catch (e) {
    console.trace(e);
  }
}
