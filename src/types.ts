import { OutputLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { Pool } from 'pg';
import { RetryingProvider } from './chain';

export interface RunDependencies {
  readonly config: StressTestConfig;
  readonly requestSets: RequestSet[];
  readonly testKey: string;
  readonly db?: Pool;
  readonly tries: number;
}

/**
 * Postgres Database config type
 */
export interface PostgresConfig {
  readonly PostgresEnabled: boolean;
  readonly user: string;
  readonly password: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
}

/**
 * JSON Output Config type
 */
export interface JsonOutputConfig {
  readonly enabled: boolean;
  readonly filePath?: string;
}

/**
 * SSH Config type
 */
export interface SshConfig {
  readonly sshKeyPath: string;
  readonly sshRemoteHost?: string;
  readonly sshUser?: string;
  readonly sshPort?: number;
  readonly yamlPath?: string;
}

/**
 * A request set - result will be RequestCount*WalletCount*ChainCount
 */
export interface RequestSet {
  readonly requestCount: number;
  readonly walletCount: number;
  readonly chainCount: number;
}

/**
 * A uniform type for a LogRecord from GCP and AWS - suitable for metrics processing.
 */
export interface LogRecord {
  readonly name: string;
  readonly duration: number;
  readonly memory_usage: number;
}

/**
 * Cloud Provider configuration - a near-copy of Airnode's config.json type.
 */
export interface CloudProvider {
  readonly type: 'aws' | 'gcp';
  readonly projectId?: string;
  readonly region: string;
}

/**
 * Stress Test Config type
 */
export interface StressTestConfig {
  readonly testRuns: Array<RequestSet>;
  readonly walletCount: number;
  readonly runRepeats: number;
  readonly postgresConfig?: PostgresConfig;
  readonly jsonOutputConfig: JsonOutputConfig;
  readonly sshConfig: SshConfig;
  readonly randomLength: number;
  readonly testType: 'MockedProvider' | 'HardHatProvider' | 'OpenEthereumProvider' | 'RopstenProvider';
  readonly infuraProviderUrl?: string;
  readonly masterWalletOverrideMnemonic?: string;
  readonly infuraProviderAirnodeOverrideURL?: string;
  readonly comment?: string;
  readonly cloudProvider: CloudProvider;
  readonly maxBatchSize?: number;
  readonly chainId?: string;
  readonly nodeVersion?: string;
}

/**
 * An interface representing LogStream objects from CloudWatch
 */
export interface LogStream {
  readonly logStreamName: string | undefined;
  readonly logGroupName: string | undefined;
  readonly arn: string | undefined;
  readonly logData: OutputLogEvent[] | undefined;
}

/**
 * A type representing the output into the Postgres database
 */
export interface OutputMetrics {
  readonly requestCount?: number;
  readonly metrics?: undefined | any[];
  readonly runStart?: number;
  readonly runEnd?: number;
  readonly runDelta?: number;
  readonly success: boolean;
  readonly walletCount?: number;
  readonly chainCount?: number;
  readonly onChainMetrics?: RequestMetrics;
  readonly testKey?: string;
}

export interface RequestMetrics {
  readonly failedFulfilments: number;
  readonly successfulFulfilments: number;
  readonly madeRequestsOnChain: number;
  readonly outstandingRequests: number;
}

export interface Receipt {
  readonly receipt: string;
  readonly sponsorWalletAddress: string;
  readonly sponsorAddress: string;
}

/**
 * A type representing Integration Info
 */
export interface IntegrationInfo {
  readonly integration: string;
  readonly airnodeType: 'aws' | 'local';
  readonly accessKeyId: string;
  readonly secretKey: string;
  readonly network: 'rinkeby' | 'localhost' | 'docker-poa-network';
  readonly mnemonic: string;
  readonly providerUrl: string;
}

export interface ContractsAndRequestsProps {
  readonly chainNumber: number;
  readonly config: StressTestConfig;
  readonly provider: RetryingProvider;
  readonly walletCount: number;
}
