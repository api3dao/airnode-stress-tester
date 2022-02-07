import { spawnSync } from 'child_process';
import { groupBy } from 'lodash';
import { contains, getStressTestConfig } from './utils';
import { LogRecord } from './types';
import { cliPrint } from './cli';
import { getGreatestStats } from './metrics-utils';

// By default, the client will authenticate using the service account file
// specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable and use
// the project specified by the GCLOUD_PROJECT environment variable. See
// https://googlecloudplatform.github.io/gcloud-node/#/docs/google-cloud/latest/guides/authentication

/**
 * Trims the output of the gcloud command.
 *
 * @param a The stdout output from the gcloud command
 */
const trimGCloudOutput = (a: string) => a.substring(1, a.length - 2);

/**
 * Retrieves logs from Google Cloud
 */
export const getGCPMetrics = async (stage: string): Promise<LogRecord[]> => {
  const { cloudProvider } = getStressTestConfig();
  const gFunctionsOutput = spawnSync(`bash`, [
    `-c`,
    `gcloud beta functions list --project=${cloudProvider.projectId} --regions=${cloudProvider.region} --format=json`,
  ]).output.toString();

  // TODO region is now required, bring in from config
  const gFunctionsList = JSON.parse(trimGCloudOutput(gFunctionsOutput))
    .filter((gf: { entryPoint: string; name: string }) => {
      switch (gf.entryPoint) {
        case 'processProviderRequests':
        case 'startCoordinator':
        case 'initializeProvider':
        case 'callApi':
          return true;
        default:
          return false;
      }
    })
    .filter((gf: { entryPoint: string; name: string }) => gf.name.indexOf(stage) > -1)
    .map((gf: { name: string }) => gf.name)
    .map((gf: string) => {
      const splitGf = gf.split('/');
      return splitGf[splitGf.length - 1];
    })
    // GCloud operates with many concurrent API calls, so this should be sync
    .map((gf: string) => {
      // Logs are not deleted when cloud functions are removed, so log retrieval must be constrained
      const gcloudProc = spawnSync(`bash`, [
        `-c`,
        `gcloud beta functions logs read "${gf}" --region=${cloudProvider.region} --project=${cloudProvider.projectId} --limit=1000 --format=json`,
      ]).output.toString();

      return JSON.parse(trimGCloudOutput(gcloudProc));
    })
    .filter((records: []) => records.length > 0)
    .flat();

  const groupedLogs = groupBy(gFunctionsList, (logEntry) => logEntry.name);

  const metrics = Object.entries(groupedLogs).map(([key, value]) => {
    const stats = getGreatestStats(
      value
        .filter((logEvent) => logEvent.log.indexOf('Function execution took') > -1)
        .map((stat) => {
          return {
            name: key,
            duration: parseInt(stat.log.split(' ')[3]),
            memory_usage: 0, // not reported by GCP
          };
        })
    );

    const fulfilledRequestsCount = (() => {
      if (key.indexOf('processProviderRequests') > -1) {
        return value.filter((logEntry) => contains(logEntry.log, 'submitted for Request')).length;
      }

      return undefined;
    })();

    const eventOccurred = (text: string) => value.filter((logEntry) => contains(logEntry.log, text)).length > 0;
    const timedOut = eventOccurred(`finished with status: 'timeout'`);
    const failed =
      eventOccurred('Exception') ||
      eventOccurred('Failed') ||
      eventOccurred('ERROR') ||
      eventOccurred('Runtime exited with error');

    return {
      ...stats,
      ...{
        logs: value,
        timedOut,
        failed,
        fulfilledRequestsCount: fulfilledRequestsCount ? fulfilledRequestsCount : 0,
      },
    };
  });

  cliPrint.info(JSON.stringify(metrics, null, 2));
  return metrics;
};
