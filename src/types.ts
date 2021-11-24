import { OutputLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { ethers } from 'ethers';

/**
 * Postgres Database config type
 */
export interface PostgresConfig {
  PostgresEnabled: boolean;
  PostgresUser: string;
  PostgresPassword: string;
  PostgresHost: string;
  PostgresPort: number;
  PostgresDatabase: string;
}

/**
 * JSON Output Config type
 */
export interface JsonOutputConfig {
  Enabled: boolean;
  FilePath?: string;
}

/**
 * SSH Config type
 */
export interface SshConfig {
  SshKeyPath: string;
  SshRemoteHost?: string;
  SshUser?: string;
  SshPort?: number;
  YamlPath?: string;
}

/**
 * A request set - result will be RequestCount*WalletCount*ChainCount
 */
export interface RequestSet {
  RequestCount: number;
  WalletCount: number;
  ChainCount: number;
}

/**
 * Stress Test Config type
 */
export interface StressTestConfig {
  TestRuns: Array<RequestSet>;
  WalletCount: number;
  RunRepeats: number;
  PostgresConfig?: PostgresConfig;
  JsonOutputConfig: JsonOutputConfig;
  SshConfig: SshConfig;
  RandomLength: number;
  TestType: 'MockedProvider' | 'HardHatProvider' | 'OpenEthereumProvider' | 'RopstenProvider';
  InfuraProviderURL?: string;
  MasterWalletOverrideMnemonic?: string;
  InfuraProviderAirnodeOverrideURL?: string;
  Comment?: string;
}

/**
 * An interface representing LogStream objects from CloudWatch
 */
export interface LogStream {
  logStreamName: string | undefined;
  logGroupName: string | undefined;
  arn: string | undefined;
  logData: OutputLogEvent[] | undefined;
}

/**
 * A convenience type to move AirnodeConfig around
 */
export interface AirNodeConfigType {
  integrationInfo: IntegrationInfo;
  requester: any;
  airnodeRrp: any; // TODO BaseContract from ethers?
  airnodeWallet: ethers.Wallet;
  sponsor: ethers.Wallet;
  endpointId: string;
  sponsorWalletAddress: string;
}

/**
 * A type representing the output into the Postgres database
 */
export interface OutputMetrics {
  requestCount: number;
  metrics: undefined | any[];
  runStart: number;
  runEnd: number;
  runDelta: number;
  success: boolean;
  walletCount: number;
  chainCount: number;
}

/**
 * A type representing a deployment of the AirnodeRrp
 */
export interface ContractsAndRequestsConfig {
  AirnodeMnemonic: string;
  AirnodeRrpAddress: string;
}

/**
 * A type representing Integration Info
 */
export interface IntegrationInfo {
  integration: string;
  airnodeType: 'aws' | 'local';
  accessKeyId: string;
  secretKey: string;
  network: 'rinkeby' | 'localhost' | 'docker-poa-network';
  mnemonic: string;
  providerUrl: string;
}