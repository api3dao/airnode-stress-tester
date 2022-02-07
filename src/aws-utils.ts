import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  OutputLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { LogStream } from './types';
import { contains } from './utils';
import { getGreatestStats, compareDescendingOutputLogEvent } from './metrics-utils';

/**
 * Gets the LogGroupName from the arn.
 *
 * Example arn: 'arn:aws:logs:us-east-1:832815310268:log-group:/aws/lambda/airnode-194b72f-dev-initializeProvider:log-stream:2021/11/03/[$LATEST]0df015c1c2a24875bb7cad5425362c4d'
 */
export const getLogGroupName = (arn: string) => {
  const tokens = arn.split(':');
  return tokens[6];
};

/**
 * Connects to CloudWatch, grabs all recent logs matching Airnode handlers, merges them together into a set of
 * contiguous arrays, pulls metrics out of them and ultimately returns an object that contains the logs as well as
 * some metadata about them/the execution run they represent.
 */
export const getMetrics = async () => {
  const client = new CloudWatchLogsClient({
    maxAttempts: 10,
  });

  const command = new DescribeLogGroupsCommand({});
  const logGroups = (await client.send(command)).logGroups;

  if (!logGroups?.filter) {
    return;
  }

  const groups = logGroups.filter((group) => group!.logGroupName!.indexOf('airnode-') > -1);
  const logStreams = await Promise.all(
    (
      await Promise.all(
        groups.map((group) => client.send(new DescribeLogStreamsCommand({ logGroupName: group.logGroupName })))
      )
    )
      .map((ls) => ls.logStreams)
      .filter((ls) => ls && ls!.length > 0)
      ?.flatMap((ls) =>
        ls!.map((lss) => {
          const logGroupName = getLogGroupName(lss!.arn!);

          return {
            arn: lss.arn,
            logStreamName: lss.logStreamName!,
            logGroupName: logGroupName!,
          };
        })
      )
      .map(async (ls) => {
        const logData = await client.send(
          new GetLogEventsCommand({
            logStreamName: ls.logStreamName,
            logGroupName: ls.logGroupName,
          })
        );

        return { ...ls, logData: logData.events }; // there's a nextBackwardToken and nextForwardToken which may be needed
      })
  );

  const logs: { [key: string]: OutputLogEvent[] } = {};
  logStreams.forEach((ls: LogStream) => {
    if (!ls.logGroupName || !ls.logData) {
      return;
    }

    if (!logs[ls.logGroupName]) {
      logs[ls.logGroupName] = new Array<OutputLogEvent>();
    }

    logs[ls.logGroupName] = logs[ls.logGroupName].concat(ls.logData);
  });

  for (const [key, value] of Object.entries(logs)) {
    // @ts-ignore
    logs[key] = value.sort(compareDescendingOutputLogEvent); // ORDER BY DESC
  }

  const metrics = [];
  for (const [key, value] of Object.entries(logs)) {
    if (!value) {
      return;
    }
    const stats = value
      .filter((loggy) => loggy.message!.indexOf('Billed Duration') > -1)
      .map((stat) => {
        if (!stat?.message?.split) {
          return;
        }

        return {
          name: key,
          // @ts-ignore
          duration: parseInt(stat.message.split('ms').flatMap((ms: string) => ms.split(' '))[3]),
          // @ts-ignore
          memory_usage: parseInt(stat.message.split('ms').flatMap((ms: string) => ms.split(' '))[15]),
        };
      });

    const fulfilledRequestsCount = (() => {
      if (key.indexOf('processProviderRequests') > -1) {
        return value.filter((loggy) => contains(loggy.message, 'submitted for Request')).length;
      }

      return undefined;
    })();

    const thisRound = getGreatestStats(stats);
    const eventOccured = (text: string) => value.filter((loggy) => contains(loggy.message, text)).length > 0;

    const didTimeout = eventOccured('Task timed out after');
    const didFail =
      eventOccured('Exception') ||
      eventOccured('Failed') ||
      eventOccured('ERROR') ||
      eventOccured('Runtime exited with error');

    // TODO we're appending all logs, only append relevant
    const merged = {
      ...thisRound,
      ...{
        logs: value,
        timedOut: didTimeout,
        failed: didFail,
        fulfilledRequestsCount,
      },
    };
    metrics.push(merged);
  }

  return metrics;
};
