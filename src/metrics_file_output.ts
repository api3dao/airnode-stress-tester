import { readFileSync, writeFileSync, existsSync } from 'fs';
import { JsonOutputConfig } from './types';

/**
 * Appends the metrics from a test run to the metrics from existing runs and writes them to file.
 * Normally a database would be used for this, but using a database adds dependencies.
 */
export const appendMetrics = (
  { Enabled, FilePath }: JsonOutputConfig,
  metrics: {
    requestCount: number;
    metrics: undefined | any[];
    runStart: number;
    runEnd: number;
    runDelta: number;
    testKey: string;
    TestType: string;
  }
) => {
  if (!Enabled || !FilePath) {
    return;
  }

  if (!existsSync(FilePath)) {
    writeFileSync(FilePath, JSON.stringify([]));
  }

  const readLogs = JSON.parse(readFileSync(FilePath).toString());
  readLogs.push(metrics);

  writeFileSync(FilePath, JSON.stringify(readLogs));
};
