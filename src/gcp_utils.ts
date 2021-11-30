import {runAndHandleErrors} from "./cli";
import {contains, doTimeout, getStressTestConfig} from "./utils";
import {spawnSync} from "child_process";
import {groupBy} from "lodash";
import {getGreatestStats} from "./aws_utils";
import {LogRecord} from "./types";

// By default, the client will authenticate using the service account file
// specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable and use
// the project specified by the GCLOUD_PROJECT environment variable. See
// https://googlecloudplatform.github.io/gcloud-node/#/docs/google-cloud/latest/guides/authentication

const trimGCloudOutput = (a: string) => {
    return a.substring(1, a.length - 2);
};

export const getGCPMetrics = async ()  :Promise<LogRecord[]> => {
    /*
    I tried using GCP's SDK... it's a nightmare; poorly documented and difficult to work with.
    I eventually settled on calling the gcloud cli app.
     */
    const {CloudProvider} = getStressTestConfig();
    const {projectId} = CloudProvider;

    const gFunctionsOutput = spawnSync(`bash`, [`-c`, `gcloud beta functions list --format=json`])
        .output.toString(); // output starts with a ',' for some reason and also ends with ','

    const gFunctionsList = JSON.parse(trimGCloudOutput(gFunctionsOutput))
        .filter((gf: { entryPoint: string, name: string }) => {
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
        .map((gf: { name: string }) => gf.name)
        .map((gf: string) => {
            const splitGf = gf.split("/");
            return splitGf[splitGf.length - 1];
        })
        // GCloud operates with concurrent API calls, so this should be sync
        .map((gf: string) => {
            const gcloudProc = spawnSync(
                `bash`,
                [`-c`, `gcloud beta functions logs read "${gf}" --filter "time_utc > \"${
                    new Date((Date.now() - (2 + 120) * 60 * 1000)).toISOString()
                }\"" --region us-east4 --format=json`])
                .output
                .toString();
            return JSON.parse(trimGCloudOutput(gcloudProc));
        })
        .filter((records: []) => records.length > 0)
        .flat();

    const groupedLogs = groupBy(gFunctionsList, logEntry => logEntry.name);
    // console.log(JSON.stringify(groupedLogs, null, 2));

    const metrics = Object.entries(groupedLogs).map(([key, value]) => {
        const stats = getGreatestStats(value
            .filter((logEvent) => logEvent.log.indexOf('Function execution took') > -1)
            .map((stat) => {
                return {
                    name: key,
                    duration: parseInt(stat.log.split(' ')[3]),
                    memory_usage: 0, // not reported by GCP
                };
            }));

        const fulfilledRequestsCount = (() => {
            if (key.indexOf('processProviderRequests') > -1) {
                return value.filter((logEntry) => contains(logEntry.log, 'submitted for Request')).length;
            }

            return undefined;
        })();

        const eventOccured = (text: string) => value.filter((logEntry) => contains(logEntry.log, text)).length > 0;
        const timedOut = eventOccured(`finished with status: 'timeout'`);
        const failed =
            eventOccured('Exception') ||
            eventOccured('Failed') ||
            eventOccured('ERROR') ||
            eventOccured('Runtime exited with error');

        const mergedStats = {
            ...stats,
            ...{
                logs: value,
                timedOut,
                failed,
                fulfilledRequestsCount: fulfilledRequestsCount ? fulfilledRequestsCount : 0
            }};
        return mergedStats;
    });

    console.log(metrics);
    return metrics;
}

/*
An example error log object
      {
        "execution_id": "013czahtxxq7",
        "log": "[2021-11-29 09:48:20.449] ERROR Error: Operation timed out in 19500 ms.",
        "name": "airnode-a03b926-dev-startCoordinator",
        "time_utc": "2021-11-29 09:48:20.449"
      },

 */

//
// //log: 'Function execution took 781 ms, finished with status code: 200',
//
//
// }
//
//
//
// const metrics = [];
// for (const [key, value] of Object.entries(logs)) {
//     if (!value) {
//         return;
//     }
//
//
//     const thisRound = getGreatestStats(stats);
//     const eventOccured = (text: string) => value.filter((loggy) => contains(loggy.message, text)).length > 0;
//
//     const didTimeout = eventOccured('Task timed out after');
//     const didFail =
//         eventOccured('Exception') ||
//         eventOccured('Failed') ||
//         eventOccured('ERROR') ||
//         eventOccured('Runtime exited with error');
//
//     // TODO we're appending all logs, only append relevant
//     const merged = { ...thisRound, ...{ logs: value, timedOut: didTimeout, failed: didFail, fulfilledRequestsCount } };
//     metrics.push(merged);
// }

/*
{
  timestamp: { seconds: 1638126579, nanos: 936000108 },
  labels: {},
  insertId: '1yrdf4we206dd',
  httpRequest: null,
  resource: {
    labels: {
      function_name: 'airnode-a03b926-dev-initializeProvider',
      project_id: 'api3-333217',
      region: 'us-east4'
    },
    type: 'cloud_function'
  },
  severity: 'NOTICE',
  logName: 'projects/api3-333217/logs/cloudaudit.googleapis.com%2Factivity',
  operation: {
    id: 'operations/YXBpMy0zMzMyMTcvdXMtZWFzdDQvYWlybm9kZS1hMDNiOTI2LWRldi1pbml0aWFsaXplUHJvdmlkZXIvRXFNWDVVWjVkX2s',
    producer: 'cloudfunctions.googleapis.com',
    first: true,
    last: false
  },
  trace: '',
  sourceLocation: null,
  receiveTimestamp: { seconds: '1638126580', nanos: 742889381 },
  spanId: '',
  traceSampled: false,
  protoPayload: {
    type_url: 'type.googleapis.com/google.cloud.audit.AuditLog',
    value: <Buffer 1a 15 0a 13 62 6c 75 65 40 61 71 75 61 72 61 74 2e 7a 61 2e 6e 65 74 22 bb 01 0a 0e 31 36 35 2e 37 33 2e 31 31 33 2e 32 35 32 12 94 01 67 6f 6f 67 6c ... 1079 more bytes>
  },
  payload: 'protoPayload',
  jsonPayload: { fields: { type_url: [Object], value: [Object] } }
}

 */

/*
aquarat@xpsrat:~/Projects/active-airnodes/airnode-stress-tester$ gcloud beta functions logs read airnode-a03b926-dev-initializeProvider --region us-east4 --format=json
LEVEL  NAME                                    EXECUTION_ID  TIME_UTC                 LOG
D      airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.799  Function execution took 927 ms, finished with status code: 200
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] INFO Pending requests: 0 API call(s), 0 withdrawal(s)                                  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0x30f70992337e69a733f7188a2cc93a76aa907600085deabce548d299b7306df4 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0x88d65a9202d64d1fc516636cf3c54b61266b92f4371861c5d61a42c0eaef2d29 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0xcba133f7ad10fac0cca8cea46e0ab0665f1a8e39946006715aae24c2f809b904 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0xee9a53e81299ae849e3da7525dc74a452c7ee43ffc300d2aebceb71990e139c4 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0x06e9caf7c44f39f0696906e45c8ad21c34d9bd7bd78ac83cfc30e315aa33bcc9 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0xcf65ad5d013ece5dda56672ad70d6bf1b5f3c4bf24ce8fad3fd9530372a9fe19 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0xc8ddaeb73032e94cbb1e2ea80e00fd5ad6e3bcea72a38b18ab12f04aa10c66f4 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0x1381f5113b9e8c967cd82a298b7644c6342c8b7da05f5b41f64ddc9625bfbe86 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.797] DEBUG Request ID verification skipped for Request:0x0cb4c8cd5a39e1cf2b0d3c5d8f552b64583780744408724409b37b183e05f352 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.797  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0x4868fe452dc50ae6a20f720c0b2f5b7bbb09c41c6f0c2a607b10d29549051102 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.796  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0x2d2690a3a54283e329bb172deebd453d029abbade1ea650ea9f2bdff396cbfdb as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.796  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0xf3d3757ae20c6449a99e3458664d3fac1531404a73f86c117bf2bed9bc1a4423 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.796  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0xc844922151da04be4c4d5610d0c1e1064b84d0428224dcbb251d55412e6e77a3 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.796  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0x804b83aa32a3c838e8275d5c4d7cc8b275dbf9a680dcd068a64986356ddcd10c as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.796  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0xb7d2b7df6717a4afe7fcb3b9e46ae886800cdd5baea0fa1cc2a71bb7cc6b513f as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.796  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0x12b65c96e2b81edf86b8e81aec14be13e5a6018b2e4ea5bc671f8541fb98b070 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.796  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0x794a5825847034db419ddc42585fe1645771ded66e1314af0f58bedf13552104 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995
       airnode-a03b926-dev-initializeProvider  mqyqjgikpghr  2021-11-26 12:02:01.796  [2021-11-26 12:02:01.796] DEBUG Request ID verification skipped for Request:0xa711755b811e5f5d7f8d3af85e11ca610af02bcdb8b34f9386f803eac3954f20 as it has status:Fulfilled  Coordinator-ID:294a9b9c0fc50318, Provider:exampleProvider, Chain:EVM, Chain-ID:8995

 */