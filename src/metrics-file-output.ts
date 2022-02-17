import { readFileSync, writeFileSync, existsSync } from 'fs';
import { JsonOutputConfig, OutputMetrics, StressTestConfig } from './types';

/**
 * Appends the metrics from a test run to the metrics from existing runs and writes them to file.
 * Normally a database would be used for this, but using a database adds dependencies.
 */
export const appendMetrics = (
  { enabled, filePath }: JsonOutputConfig,
  metrics: OutputMetrics,
  { testType, comment }: StressTestConfig
) => {
  if (!enabled || !filePath) {
    return;
  }

  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify([]));
  }

  const readLogs = JSON.parse(readFileSync(filePath).toString());
  readLogs.push({ ...metrics, testType: testType, comment: comment });

  writeFileSync(filePath, JSON.stringify(readLogs));
};
