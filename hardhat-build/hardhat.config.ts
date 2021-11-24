import { existsSync, readFileSync } from 'fs';
import { HardhatUserConfig } from 'hardhat/types';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers';

export interface IntegrationInfo {
  integration: string;
  airnodeType: 'aws' | 'local';
  accessKeyId: string;
  secretKey: string;
  network: 'rinkeby' | 'localhost';
  mnemonic: string;
  providerUrl: string;
}

const integrationInfoPath = '/root/integration-info.json';
let integrationInfo: IntegrationInfo | null = null;
if (existsSync(integrationInfoPath)) {
  integrationInfo = JSON.parse(readFileSync('/root/integration-info.json').toString());
}

const networks: any = {};
if (integrationInfo) {
  networks[integrationInfo.network] = {
    url: integrationInfo.providerUrl,
    mining: {
      auto: false,
      interval: [9000, 11000],
    },
    accounts: { mnemonic: integrationInfo.mnemonic },
    loggingEnabled: true,
  };
}

const config: HardhatUserConfig = {
  defaultNetwork: integrationInfo?.network,
  networks,
  solidity: '0.8.6',
};

export default config;
