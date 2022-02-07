import { OutputLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { ethers } from 'ethers';
import { parseAirnodeRrpLog } from '@api3/airnode-node/dist/src/evm/requests';
import { orderBy } from 'lodash';
import { doTimeout, getIntegrationInfo, getStressTestConfig } from './utils';
import { getGCPMetrics } from './gcp-utils';
import { LogRecord, RequestMetrics } from './types';
import { getMetrics } from './aws-utils';
import { getProvider } from './chain';

const getOnChainRequestMetrics = async (rrpAddresses: string[]) => {
  const requestMetrics = (await Promise.all(
    rrpAddresses.flatMap(async (airnodeRrpAddress) => {
      try {
        const provider = getProvider(getIntegrationInfo());
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 1000); // maybe this isn't required

        const filter: ethers.providers.Filter = {
          fromBlock,
          toBlock: currentBlock,
          address: airnodeRrpAddress,
          // we don't need to filter because we deploy new AirnodeRrps for consistency/clean slate
        };

        const rawLogs = await provider.getLogs(filter);

        const logsWithBlocks = rawLogs
          .map((log) => ({
            address: log.address,
            blockNumber: log.blockNumber,
            blockNumberDelta: currentBlock - log.blockNumber,
            currentBlock: currentBlock,
            transactionHash: log.transactionHash,
            // If the provider returns a bad response, mapping logs could also throw
            parsedLog: parseAirnodeRrpLog(log),
          }))
          .filter(({ parsedLog }) => parsedLog.name === 'FulfilledRequest' || parsedLog.name === 'FailedRequest')
          .map((logEntry) => {
            return {
              ...logEntry,
              requestId: logEntry.parsedLog.args[1],
            };
          });

        const fulfillments = logsWithBlocks?.filter(
          ({ parsedLog }) => parsedLog.name === 'FulfilledRequest' || parsedLog.name === 'FailedRequest'
        );
        const failedFulfilments = logsWithBlocks?.filter(({ parsedLog }) => parsedLog.name === 'FailedRequest')?.length;
        const successfulFulfilments = logsWithBlocks.filter(
          ({ parsedLog }) => parsedLog.name === 'FulfilledRequest'
        ).length;
        const requests = logsWithBlocks.filter((logEntry) => logEntry.parsedLog.name === 'MadeTemplateRequest');
        const outstanding = orderBy(
          requests?.filter((request) => !fulfillments.find((fulfilment) => fulfilment.requestId === request.requestId)),
          ['blockNumberDelta'],
          ['desc']
        );

        return {
          failedFulfilments,
          successfulFulfilments,
          madeRequestsOnChain: requests.length,
          outstandingRequests: outstanding.length,
        };
      } catch (e) {
        console.trace(e);
      }

      return null;
    })
  )) as RequestMetrics[];

  return requestMetrics
    .filter((metrics) => !!metrics)
    .reduce(
      (previous, current) => {
        return {
          failedFulfilments: previous.failedFulfilments + current.failedFulfilments,
          successfulFulfilments: previous.successfulFulfilments + current.successfulFulfilments,
          madeRequestsOnChain: previous.madeRequestsOnChain + current.madeRequestsOnChain,
          outstandingRequests: previous.outstandingRequests + current.outstandingRequests,
        };
      },
      {
        failedFulfilments: 0,
        successfulFulfilments: 0,
        madeRequestsOnChain: 0,
        outstandingRequests: 0,
      }
    );
};

/**
 * Tries to retrieve logs from CloudWatch and checks the result for a complete log set.
 */
export const collectMetrics = async (
  stage: string,
  airnodeRrps: string[]
): Promise<{
  metrics: any;
  onChainMetrics: RequestMetrics;
  success: boolean;
}> => {
  const { cloudProvider } = getStressTestConfig();
  const isAws = cloudProvider.type === 'aws';

  for (let count = 15; count > -1; count--) {
    try {
      await doTimeout(10000);
      const metrics = isAws ? await getMetrics() : await getGCPMetrics(stage);
      const success =
        metrics?.filter((record: LogRecord) => record.name.length > 1).length === 4 &&
        metrics?.filter((record: LogRecord) => record.duration > 10).length === 4 &&
        ((isAws && metrics?.filter((record: LogRecord) => record.memory_usage > 10).length === 4) || !isAws);

      if (success || count === 0) {
        // a delay because transactions may not have been committed
        // ideally the Airnode needs to be manually triggered...
        await doTimeout(40_000);
        const onChainMetrics = await getOnChainRequestMetrics(airnodeRrps);
        return {
          metrics,
          onChainMetrics,
          success,
        };
      }
    } catch (e) {
      console.trace(`Attempt ${count} failed: `, e);
    }
  }

  try {
    const onChainMetrics = await getOnChainRequestMetrics(airnodeRrps);
    return {
      metrics: [],
      onChainMetrics,
      success: false,
    };
  } catch (e) {
    console.trace(e);
  }

  return {
    metrics: [],
    onChainMetrics: {
      failedFulfilments: -1,
      successfulFulfilments: -1,
      madeRequestsOnChain: -1,
      outstandingRequests: -1,
    },
    success: false,
  };
};

/**
 * A sort function to arrange records descending for OutputLogEvents
 */
export const compareDescendingOutputLogEvent = (a: OutputLogEvent, b: OutputLogEvent) => {
  if (!a.timestamp || !b.timestamp) {
    return 0; //shouldn't be possible
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
