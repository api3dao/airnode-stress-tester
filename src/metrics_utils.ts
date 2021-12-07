import { OutputLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { doTimeout, getStressTestConfig } from './utils';
import { getGCPMetrics } from './gcp_utils';
import { LogRecord } from './types';
import { getMetrics } from './aws_utils';

/**
 * Tries to retrieve logs from CloudWatch and checks the result for a complete log set.
 */
export const collectMetrics = async (): Promise<{
  metrics: any;
  success: boolean;
}> => {
  const { CloudProvider } = getStressTestConfig();
  const isAws = CloudProvider.type === 'aws';

  for (let count = 15; count > -1; count--) {
    try {
      await doTimeout(10000);
      const metrics = isAws ? await getMetrics() : await getGCPMetrics();
      const success =
        metrics?.filter((record: LogRecord) => record.name.length > 1).length === 4 &&
        metrics?.filter((record: LogRecord) => record.duration > 10).length === 4 &&
        ((isAws && metrics?.filter((record: LogRecord) => record.memory_usage > 10).length === 4) || !isAws);

      if (success || count === 0) {
        return { metrics, success };
      }
    } catch (e) {
      console.trace(`Attempt ${count} failed: `, e);
    }
  }

  return { metrics: [], success: false };
};

/**
 * A sort function to arrange records descending for OutputLogEvents
 */
export const compareDescendingOutputLogEvent = (a: OutputLogEvent, b: OutputLogEvent) => {
  if (!a.timestamp || !b.timestamp) {
    return 0; //shoudn't be possible
  }

  if (a.timestamp > b.timestamp) {
    return -1;
  }

  if (a.timestamp < b.timestamp) {
    return 1;
  }

  return 0;
};

/**
 * It is possible for multiple runs of various handlers to occur in the time period being assessed - `callApi`, for
 * instance will always run multiple times. We therefore want the worst timing and RAM usage of the runs. This finds
 * those values.
 */
export const getGreatestStats = (stats: ({ name: string; duration: number; memory_usage: number } | undefined)[]) => {
  if (!stats) {
    return { name: '', duration: -1, memory_usage: -1 };
  }

  const maxDuration = stats.reduce((accu, cv) => {
    if (!cv) {
      return accu;
    }

    if (cv.duration > accu) {
      return cv.duration;
    }

    return accu;
  }, 0);

  const maxMemory = stats.reduce((accu, cv) => {
    if (!cv) {
      return accu;
    }

    if (cv.memory_usage > accu) {
      return cv.memory_usage;
    }

    return accu;
  }, 0);

  const name = stats[0]?.name ? stats[0]?.name : '';

  return { name: name, duration: maxDuration, memory_usage: maxMemory };
};
