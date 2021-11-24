/**
 * This is an *extremely* rough-and-ready tool/example of how to pull metrics out of previously logged stress tests.
 * It is intended to be combined with annotated entry/exit log indicators so as to allow troubleshooting of timing in
 * functions.
 *
 * An example of an annotated function in Airnode *could* look like:
 *
 * const annotate = async (fn: (...args: any[]) => :any), args: any, name: string) => {
 *   const uuid = crypto.randomUUID();
 *   console.log(`###FLAME ${uuid} ${name}`);
 *   const result = fn(...args);
 *   console.log(`###FLAME ${uuid} ${name}`);
 *   return result;
 * };
 *
 * This is untested, the original implementation was simpler than this.
 */

import { getStressTestConfig } from './utils';
import { initDB } from './database';
import { contains } from './utils';

//'2021-11-19T11:33:32.754Z\t55ad4867-fc3e-4375-ac50-e5a4dd07ff1d\tTRACE\t###FLAME get gas price\n'
const getTraceProps = (log: any) => {
  const trace = log.message;
  const splits = trace.split('\n').flatMap((str: any) => str.split('\t'));

  const messagePos = splits[3].indexOf("###FLAME")+9;

  return {
    time: log.timestamp,//Date.parse(splits[0]),
    uuid: splits[1],
    message: splits[3].substring(messagePos)
  };
};

const main = async () => {
  const {
    PostgresConfig,
  } = getStressTestConfig();

  const pg = initDB(PostgresConfig!);

  await pg.query(
      `CREATE TABLE IF NOT EXISTS parsed_traces (
    id SERIAL PRIMARY KEY,
    test_key TEXT,
    metric_name TEXT,
    metric_start TIMESTAMP,
    metric_end TIMESTAMP
);`);

  const metricsQueryResult = (await pg.query(`select metrics, test_key from metrics order by run_end desc limit 1;`)).rows[0];
  const metrics = metricsQueryResult.metrics;
  const test_key = metricsQueryResult.test_key;
  // const metrics = JSON.parse((await pg.query({
  //   text: `select metrics from metrics where run_end = $1;`,
  //   values: [runEnd]
  // })).rows[0]["metrics"]);
//  console.log(runEnd);


  const ppr = metrics.find((record: any) => contains(record.name, `processProviderRequests`));
  const flameLogs = ppr.logs.filter((log: any) => contains(log.message, "###FLAME")).map((log: any) => getTraceProps(log));

  console.log(flameLogs);

  const messages = {};
  flameLogs.forEach((fl: any) => {
    // @ts-ignore
    if (!messages[fl.message]) {
      // @ts-ignore
      messages[fl.message] = [];
    }

    // @ts-ignore
    messages[fl.message].push(fl);
  });

  // console.log(messages);
  // @ts-ignore
  const events = [];
  for (const key of Object.keys(messages)) {
    try {
      const event = {};

      // @ts-ignore
      event.name = key;
      // @ts-ignore
      event.timeDelta = messages[key][0].time - messages[key][1].time;
      events.push(event);


      await pg.query(
        `INSERT INTO parsed_traces (test_key, metric_name, metric_start, metric_end) 
    VALUES ($1, $2, to_timestamp($3/1000.0), to_timestamp($4/1000.0))`,
        [
          test_key,
          key,
          // @ts-ignore
          messages[key][0].time,
          // @ts-ignore
          messages[key][1].time,
        ]
      );
    } catch (e) {
      // console.trace(e);
      console.log("tag mismatch", key);
    }
  }

  // @ts-ignore
  events.sort((a: any, b: any) => {
    if (a.timeDelta > b.timeDelta) {
      return 1;
    }

    if (a.timeDelta < b.timeDelta) {
      return -1;
    }

    return 0;
  });

  // @ts-ignore
  console.log(events);
/*
    id SERIAL PRIMARY KEY,
    test_key TEXT,
    metric_name TEXT,
    metric_start TIMESTAMP,
    metric_end TIMESTAMP
 */
};

try {
  main();
} catch (e) {
  console.trace(e);
}
