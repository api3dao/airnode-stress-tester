'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
var fs_1 = require('fs');
require('@nomiclabs/hardhat-waffle');
require('@nomiclabs/hardhat-ethers');
var integrationInfoPath = '/root/integration-info.json';
var integrationInfo = null;
if ((0, fs_1.existsSync)(integrationInfoPath)) {
  integrationInfo = JSON.parse((0, fs_1.readFileSync)('/root/integration-info.json').toString());
}
var networks = {};
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
var config = {
  defaultNetwork: integrationInfo === null || integrationInfo === void 0 ? void 0 : integrationInfo.network,
  networks: networks,
  solidity: '0.8.6',
};
exports.default = config;
