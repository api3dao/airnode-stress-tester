import { deepCopy } from 'ethers/lib/utils';
import { generateRandomString, getStressTestConfig } from './utils';
import { DEFAULT_CHAIN_ID } from './constants';

const templateConfigJson = {
  chains: [
    {
      options: {
        txType: 'eip1559',
        baseFeeMultiplier: '6',
        priorityFee: {
          value: '9.12',
          unit: 'gwei',
        },
      },
      maxConcurrency: 1000,
      authorizers: [],
      contracts: {
        AirnodeRrp: '${AIRNODE_RRP_ADDRESS}',
      },
      id: '8995',
      providers: {
        exampleProvider: {
          url: '${PROVIDER_URL}',
        },
      },
      type: 'evm',
    },
  ],
  nodeSettings: {
    airnodeWalletMnemonic: '${AIRNODE_WALLET_MNEMONIC}',
    heartbeat: {
      enabled: false,
    },
    httpGateway: {
      enabled: false,
    },
    logFormat: 'plain',
    logLevel: 'ERROR',
    nodeVersion: '0.2.2',
    stage: 'dev',
  },
  triggers: {
    rrp: [
      {
        endpointId: '0xf466b8feec41e9e50815e0c9dca4db1ff959637e564bb13fefa99e9f9f90453c',
        oisTitle: 'CoinGecko basic request',
        endpointName: 'coinMarketData',
      },
    ],
  },
  ois: [
    {
      oisFormat: '1.0.0',
      title: 'CoinGecko basic request',
      version: '1.0.0',
      apiSpecifications: {
        servers: [
          {
            url: 'https://i9zjclss79.execute-api.us-east-1.amazonaws.com/default',
          },
        ],
        paths: {
          '/stress-tester-mock-coingecko-api': {
            get: {
              parameters: [
                {
                  in: 'query',
                  name: 'localization',
                },
                {
                  in: 'query',
                  name: 'tickers',
                },
                {
                  in: 'query',
                  name: 'market_data',
                },
                {
                  in: 'query',
                  name: 'community_data',
                },
                {
                  in: 'query',
                  name: 'developer_data',
                },
                {
                  in: 'query',
                  name: 'sparkline',
                },
              ],
            },
          },
        },
        components: {
          securitySchemes: {},
        },
        security: {},
      },
      endpoints: [
        {
          name: 'coinMarketData',
          operation: {
            method: 'get',
            path: '/stress-tester-mock-coingecko-api',
          },
          fixedOperationParameters: [
            {
              operationParameter: {
                in: 'query',
                name: 'localization',
              },
              value: 'false',
            },
            {
              operationParameter: {
                in: 'query',
                name: 'tickers',
              },
              value: 'false',
            },
            {
              operationParameter: {
                in: 'query',
                name: 'market_data',
              },
              value: 'true',
            },
            {
              operationParameter: {
                in: 'query',
                name: 'community_data',
              },
              value: 'false',
            },
            {
              operationParameter: {
                in: 'query',
                name: 'developer_data',
              },
              value: 'false',
            },
            {
              operationParameter: {
                in: 'query',
                name: 'sparkline',
              },
              value: 'false',
            },
          ],
          reservedParameters: [
            {
              name: '_type',
              fixed: 'int256',
            },
            {
              name: '_path',
              fixed: 'market_data.current_price.usd',
            },
            {
              name: '_times',
              fixed: '1000000',
            },
          ],
          parameters: [],
        },
      ],
    },
  ],
  apiCredentials: [],
};

/**
 * Generate a config.json file with a number of chain definitions.
 *
 * @param chainRrps An array of strings representing AirnodeRrps
 */
export const generateConfigJson = (chainRrps: string[]) => {
  const stageIdentifier = generateRandomString(6);
  const { cloudProvider, chainId, nodeVersion } = getStressTestConfig();
  const configSource = deepCopy(templateConfigJson);
  const config = {
    ...configSource,
    nodeSettings: {
      ...configSource.nodeSettings,
      cloudProvider: cloudProvider,
      nodeVersion: nodeVersion ? nodeVersion : 'v0.0.1',
      stage: stageIdentifier,
    },
  };

  const chains = chainRrps.map((rrp, idx) => {
    return {
      maxConcurrency: 1000,
      options: {
        txType: 'eip1559',
        baseFeeMultiplier: '2',
        priorityFee: {
          value: '3.12',
          unit: 'gwei',
        },
      },
      contracts: {
        AirnodeRrp: rrp,
      },
      id: (chainId ? chainId : DEFAULT_CHAIN_ID).toString(10),
      providers: {
        [`provider chain ${idx}`]: {
          url: '${PROVIDER_URL}',
        },
      },
      type: 'evm',
    };
  });

  return { ...config, chains };
};
