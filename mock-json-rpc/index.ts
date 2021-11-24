import { readFileSync } from 'fs';
import express from 'express';
import { keccak256 } from 'ethers/lib/utils';
import { cloneDeep } from 'lodash';
const app = express();
const port = 80; // default port to listen

const logTemplates = JSON.parse(readFileSync('getLogs.json').toString());

export const getLogs = (count: number) => {
  const trimmedLogs = cloneDeep(logTemplates);
  trimmedLogs.result = trimmedLogs.result.slice(
    0,
    count < trimmedLogs.result.length ? count : trimmedLogs.result.length - 1
  );
  return trimmedLogs;
};

app.use(
  express.json({
    type: '*/*', // optional, only if you want to be sure that everything is parsed as JSON. Wouldn't recommend
  })
);

const postHandler = (req: any, res: any) => {
  console.log('Body', req.body);
  const urlLogCount = parseInt(req.url.split('/')[1], 10);
  const logMax = !isNaN(urlLogCount) ? urlLogCount : 100;

  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const incoming = req.body;

    if (!incoming.method) {
      res.statusCode = 500;
      return;
    }

    res.statusCode = 200;
    switch (incoming.method) {
      case 'eth_chainId':
        res.json({ jsonrpc: '2.0', id: incoming.id, result: '0x7a69' });
        break;
      case 'eth_blockNumber':
        res.json({ jsonrpc: '2.0', id: incoming.id, result: '0x80' });
        break;
      case 'eth_getLogs':
        // not using .json so we can pre-render the json for speed
        res.json(getLogs(logMax));
        break;
      case 'eth_getTrans':
        res.send({ jsonrpc: '2.0', id: incoming.id, result: '0x0' });

        break;
      case 'eth_getTransactionCount':
        res.send({
          id: incoming.id,
          jsonrpc: '2.0',
          result: '0x0',
        });

        break;
      case 'eth_gasPrice':
        res.send({
          id: incoming.id,
          jsonrpc: '2.0',
          result: '0x3bcb5615',
        });

        break;
      case 'eth_call':
        res.send({
          id: incoming.id,
          jsonrpc: '2.0',
          result:
            '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000',
        });
        break;
      case 'eth_getBlockByNumber':
        res.send({
          id: incoming.id,
          jsonrpc: '2.0',
          result: {
            baseFeePerGas: '0x308c15',
            difficulty: '0x209c7',
            extraData: '0x',
            gasLimit: '0x1c9c380',
            gasUsed: '0x0',
            hash: '0x119794d43388df50a6139d5774796be28423f3bcb59980b9118a96ef822b0dd6',
            logsBloom:
              '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            miner: '0xc014ba5ec014ba5ec014ba5ec014ba5ec014ba5e',
            mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
            nonce: '0x0000000000000042',
            number: '0x2c',
            parentHash: '0x321a7a8786900ffa47948849e8de1529159d7b40335ada51df085ac37c9b9182',
            receiptsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
            sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
            size: '0x204',
            stateRoot: '0x3f91540da0a9816bbcd93423bf85ece6e620358ee6cb693e3085c1e4aa106e1f',
            timestamp: '0x6189289c',
            totalDifficulty: '0x58c31d',
            transactions: [],
            transactionsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
            uncles: [],
          },
        });
        break;
      case 'eth_sendRawTransaction':
        try {
          res.send({
            id: incoming.id,
            jsonrpc: '2.0',
            result: keccak256(incoming.params[0]),
          });
        } catch (e) {
          console.trace(e);
        }
        break;
      default:
        res.statusCode = 505;
        res.send(JSON.stringify({ Error: 'Invalid Method' }));
    }
  } catch (e) {
    console.trace(e);
  }
};

app.post('/', postHandler);
app.post('/:runCount', postHandler);

app.listen(port, () => {
  console.log(`server started at http://localhost:${port}`);
});

/*
secrets.env config:

PROVIDER_URL=https://mockedrpc.api3mock.link/3/
AIRNODE_WALLET_MNEMONIC=skate viable exhibit general garment shrug enough crucial oblige victory ritual fringe
AIRNODE_RRP_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
CHAIN_ID=31337
CLOUD_PROVIDER_TYPE=local
HTTP_GATEWAY_API_KEY=061c7550-0773-42ae-a911-bbc020294925
 */
