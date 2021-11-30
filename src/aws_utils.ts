import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  OutputLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { LogStream, LogRecord } from './types';
import {contains, doTimeout, getStressTestConfig} from './utils';
import {getGCPMetrics} from "./gcp_utils";

/**
 * A sort function to arrange records descending for OutputLogEvents
 */
const compareDescendingOutputLogEvent = (a: OutputLogEvent, b: OutputLogEvent) => {
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
  //({name: string, duration: number, memory_usage: number}
  // can use a factory function... later
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
    const merged = { ...thisRound, ...{ logs: value, timedOut: didTimeout, failed: didFail, fulfilledRequestsCount } };
    metrics.push(merged);
  }

  return metrics;
};

/**
 * Tries to retrieve logs from CloudWatch and checks the result for a complete log set.
 */
export const collectMetrics = async (): Promise<{ metrics: any; success: boolean }> => {
  const { CloudProvider } = getStressTestConfig();
  const isAws = CloudProvider.name === 'aws';

  for (let count = 15; count > -1; count--) {
    try {
      await doTimeout(10000);
      const metrics = isAws ? await getMetrics() : await getGCPMetrics();
      const success =
        metrics?.filter((record: LogRecord) => record.name.length > 1).length === 4 &&
        metrics?.filter((record: LogRecord) => record.duration > 10).length === 4 &&
        (
            (isAws && metrics?.filter((record: LogRecord) => record.memory_usage > 10).length === 4) || !isAws
        );

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
 * [WIP] A last-ditch effort to clean up an Airnode AWS deployment.
 * This is incomplete, but I'm leaving it here as it contains my research into using the AWS SDK to effect the above.
 *
 * Sometimes the deployer leaves behind an incomplete installation (usually due to being interrupted/typeical BZFT
 * problem). In these scenarios manual removal is needed. This is unacceptable for the stress tester as it needs to run
 * autonomously. This function will deal with that... eventually.
 */
const _cleanAWSInstallation = async () => {
  const promises = [];
  const s3client = new S3Client({ region: 'us-east-1' });
  const deleteBuckets = async (triesRemaining?: number) => {
    return s3client
      .send(new ListBucketsCommand({}))
      .then((listBucketsCommandResults) => {
        listBucketsCommandResults.Buckets?.flatMap((bucket) => {
          if (contains(bucket.Name, 'airnode')) {
            // list objects in bucket, delete all objects in bucket, delete bucket
            // s3 bucket follows form airnode-shortcode-dev-terraform
            // dynamodb airnode-a03b926-dev-terraform-lock
            // eventbridge airnode-a03b926-dev-startCoordinator-schedule-rule
            /* lambda

 Function name
 Description
 Package type
 Runtime
 Code size
 Last modified

 airnode-a03b926-dev-startCoordinator	-	Zip	Node.js 14.x	1.4 MB	1 minute ago

 airnode-a03b926-dev-initializeProvider	-	Zip	Node.js 14.x	1.4 MB	2 minutes ago

 airnode-a03b926-dev-callApi	-	Zip	Node.js 14.x	1.4 MB	2 minutes ago

 airnode-a03b926-dev-processProviderRequests
           */
            /*
          IAM
Role name
Trusted entities
Last activity

airnode-a03b926-dev-callApi-role
AWS Service: lambda
-

airnode-a03b926-dev-initializeProvider-role
AWS Service: lambda
-

airnode-a03b926-dev-processProviderRequests-role
AWS Service: lambda
-

airnode-a03b926-dev-startCoordinator-role
           */
          }
        });
      })
      .catch((e) => {
        console.trace('Unable to delete buckets, will retry: ', e);
        if (triesRemaining && triesRemaining > -1) {
          const newTriesRemaining = triesRemaining ? triesRemaining-- : 5;
          deleteBuckets(newTriesRemaining).catch();
        }
      });
  };
  promises.push(deleteBuckets());

  return Promise.all(promises);
};
