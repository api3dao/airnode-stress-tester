import { deepCopy } from 'ethers/lib/utils';
import { ContractsAndRequestsConfig } from './types';

const templateConfigJson = {
  chains: [
    {
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
    cloudProvider: 'aws',
    airnodeWalletMnemonic: '${AIRNODE_WALLET_MNEMONIC}',
    heartbeat: {
      enabled: false,
    },
    httpGateway: {
      enabled: false,
    },
    logFormat: 'plain',
    logLevel: 'DEBUG',
    nodeVersion: '0.2.2',
    region: 'us-east-1',
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
            url: 'https://mock-api.api3mock.link',
          },
        ],
        paths: {
          '/coins/{id}': {
            get: {
              parameters: [
                {
                  in: 'path',
                  name: 'id',
                },
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
            path: '/coins/{id}',
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
          parameters: [
            {
              name: 'coinId',
              operationParameter: {
                in: 'path',
                name: 'id',
              },
            },
          ],
          testable: true,
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
export const generateConfigJson = (chainRrps: ContractsAndRequestsConfig[]) => {
  const config = deepCopy(templateConfigJson);

  const chains = chainRrps.map((rrp) => {
    return {
      authorizers: [],
      contracts: {
        AirnodeRrp: rrp.AirnodeRrpAddress,
      },
      id: '8995',
      providers: {
        exampleProvider: {
          url: '${PROVIDER_URL}',
        },
      },
      type: 'evm',
    };
  });

  return { ...config, chains };
};
