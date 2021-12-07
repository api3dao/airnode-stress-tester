import { Pool } from 'pg';
import { OutputMetrics, PostgresConfig, StressTestConfig } from './types';
import { cliPrint } from './cli';

/**
 * Initialises the database using the supplied configuration object
 *
 * @param pgConfig
 */
export const initDB = (pgConfig: PostgresConfig) => {
  const pgPool = new Pool({
    user: pgConfig.PostgresUser,
    host: pgConfig.PostgresHost,
    password: pgConfig.PostgresPassword,
    database: pgConfig.PostgresDatabase,
    port: pgConfig.PostgresPort,
    ssl: false,
  });

  pgPool
    .query(
      `CREATE TABLE IF NOT EXISTS metrics (
    id SERIAL PRIMARY KEY,
    test_key TEXT,
    success BOOLEAN,
    request_count INTEGER,
    wallet_count INTEGER,
    chain_count INTEGER,
    run_start TIMESTAMP,
    run_end TIMESTAMP,
    run_delta INTERVAL,
    metrics JSONB,
    test_type TEXT,
    comment TEXT
);`
    )
    .catch((e) => {
      cliPrint.error(
        'Postgres table creation failed - this should not happen and indicates a database config problem.'
      );
      console.trace(e);
      process.exit(1);
    })
    .then();

  return pgPool;
};

/**
 * Writes test telemetry to the database.
 *
 * @param pg A Postgres connection pool object
 * @param metrics The metrics to write
 * @param testKey The test's unique UUID identifier
 * @param TestType What kind of test was run (provider specific)
 * @param Comment A commend for the test
 */
export const sendToDB = async (
  pg: Pool | null,
  metrics: OutputMetrics,
  testKey: string,
  { TestType, Comment }: StressTestConfig
) => {
  return new Promise<void>((resolve, reject) => {
    if (!pg) {
      return;
    }

    pg.query(
      `INSERT INTO metrics (request_count, run_start, run_end, run_delta, metrics, test_key,
 test_type, success, wallet_count, chain_count, comment) 
    VALUES ($1, to_timestamp($2/1000.0), to_timestamp($3/1000.0), $4 * '1 millisecond'::INTERVAL, $5, $6, $7, $8, $9, $10, $11)`,
      [
        metrics.requestCount,
        metrics.runStart,
        metrics.runEnd,
        metrics.runDelta,
        JSON.stringify(metrics.metrics),
        testKey,
        TestType,
        metrics.success,
        metrics.walletCount,
        metrics.chainCount,
        Comment,
      ]
    )
      .catch((e) => {
        console.trace(e);
        reject(e);
      })
      .then(() => {
        resolve();
      });
  });
};
