import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, it } from 'node:test';
// Explicit `.ts` extension: run by `node --test` straight from source, excluded from the build.
import {
  EVM_NETWORKS,
  chainIdToCaip,
  chainIdToHex,
  evmRpcCandidates,
  probeEvmRpc,
  waitForEthTransactionMined,
  type EvmRpcRequester,
  type EvmNetwork,
} from './evm.ts';

describe('chainIdToHex', () => {
  it('renders a chain id in the 0x form eth_chainId and older wallet testids use', () => {
    assert.equal(chainIdToHex(11155111), '0xaa36a7');
    assert.equal(chainIdToHex(1), '0x1');
    assert.equal(chainIdToHex(1337), '0x539');
  });

  it('throws on a non-integer chain id rather than emitting 0xNaN', () => {
    assert.throws(() => chainIdToHex(1.5), /chainIdToHex/);
    assert.throws(() => chainIdToHex(Number.NaN), /chainIdToHex/);
    assert.throws(() => chainIdToHex(Number.POSITIVE_INFINITY), /chainIdToHex/);
  });

  it('throws on a negative chain id', () => {
    assert.throws(() => chainIdToHex(-1), /non-negative integer/);
  });
});

describe('chainIdToCaip', () => {
  it('renders the CAIP-2 form recent MetaMask builds use in network testids', () => {
    assert.equal(chainIdToCaip(11155111), 'eip155:11155111');
    assert.equal(chainIdToCaip(1), 'eip155:1');
  });

  it('throws on a non-integer or negative chain id', () => {
    assert.throws(() => chainIdToCaip(1.5), /chainIdToCaip/);
    assert.throws(() => chainIdToCaip(-11155111), /non-negative integer/);
  });
});

describe('EVM_NETWORKS presets', () => {
  it('ships Sepolia as chain 11155111 with at least one RPC', () => {
    assert.equal(EVM_NETWORKS.sepolia.chainId, 11155111);
    assert.equal(EVM_NETWORKS.sepolia.testnet, true);
    assert.ok(EVM_NETWORKS.sepolia.rpcUrls.length > 0);
  });

  it('marks localhost as not built in — it must be added through the custom-network form', () => {
    assert.equal(EVM_NETWORKS.localhost.builtIn, false);
  });
});

describe('evmRpcCandidates', () => {
  const network: EvmNetwork = {
    chainId: 424242,
    name: 'Candidate Test Net',
    rpcUrls: ['https://preset-a.example', 'https://preset-b.example'],
    currencySymbol: 'TST',
    builtIn: false,
    testnet: true,
  };
  const chainVar = `WALLETS_E2E_RPC_URL_${network.chainId}`;

  afterEach(() => {
    delete process.env[chainVar];
    delete process.env.WALLETS_E2E_EVM_RPC_URL;
  });

  it('returns the preset list unchanged when neither env var is set', () => {
    assert.deepEqual(evmRpcCandidates(network), [...network.rpcUrls]);
  });

  it('puts the chain-specific override first', () => {
    process.env[chainVar] = 'https://override-chain.example';
    assert.deepEqual(evmRpcCandidates(network), [
      'https://override-chain.example',
      ...network.rpcUrls,
    ]);
  });

  it('puts the all-networks override after the chain-specific one', () => {
    process.env[chainVar] = 'https://override-chain.example';
    process.env.WALLETS_E2E_EVM_RPC_URL = 'https://override-any.example';
    assert.deepEqual(evmRpcCandidates(network), [
      'https://override-chain.example',
      'https://override-any.example',
      ...network.rpcUrls,
    ]);
  });

  it('uses the all-networks override alone when no chain-specific one is set', () => {
    process.env.WALLETS_E2E_EVM_RPC_URL = 'https://override-any.example';
    assert.deepEqual(evmRpcCandidates(network), ['https://override-any.example', ...network.rpcUrls]);
  });

  it('never lists the same URL twice, so a failover walk cannot retry a dead endpoint', () => {
    process.env[chainVar] = 'https://preset-a.example';
    assert.deepEqual(evmRpcCandidates(network), [...network.rpcUrls]);
  });

  it('ignores a blank/whitespace override rather than probing an empty URL', () => {
    process.env[chainVar] = '   ';
    assert.deepEqual(evmRpcCandidates(network), [...network.rpcUrls]);
  });
});

describe('probeEvmRpc', () => {
  const CHAIN_ID = 11155111;
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  /** Stands up a one-off local HTTP endpoint so these rows exercise the real fetch path. */
  async function serve(
    handler: (method: string) => { status?: number; headers?: Record<string, string>; body: string },
  ): Promise<string> {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        let method = '';
        try {
          method = JSON.parse(Buffer.concat(chunks).toString('utf8')).method ?? '';
        } catch {
          method = '';
        }
        const { status = 200, headers = { 'Content-Type': 'application/json' }, body } = handler(method);
        res.writeHead(status, headers);
        res.end(body);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server!.address();
    if (typeof address === 'string' || address === null) throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
  }

  function jsonRpc(result: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id: 1, result });
  }

  it('accepts a node that answers chainId, blockNumber and gasPrice', async () => {
    const url = await serve((method) => {
      if (method === 'eth_chainId') return { body: jsonRpc('0xaa36a7') };
      if (method === 'eth_blockNumber') return { body: jsonRpc('0x123456') };
      return { body: jsonRpc('0x3b9aca00') };
    });
    assert.equal(await probeEvmRpc(url, CHAIN_ID), true);
  });

  it('accepts a differently-cased / zero-padded chain id — same chain, different spelling', async () => {
    const url = await serve((method) => {
      if (method === 'eth_chainId') return { body: jsonRpc('0x0AA36A7') };
      if (method === 'eth_blockNumber') return { body: jsonRpc('0x1') };
      return { body: jsonRpc('0x1') };
    });
    assert.equal(await probeEvmRpc(url, CHAIN_ID), true);
  });

  it('rejects an endpoint that answers with HTML instead of JSON-RPC', async () => {
    const url = await serve(() => ({
      headers: { 'Content-Type': 'text/html' },
      body: '<!doctype html><html><body>Just a moment...</body></html>',
    }));
    assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
  });

  it('rejects a redirect rather than following it to somewhere unverified', async () => {
    const url = await serve(() => ({
      status: 302,
      headers: { Location: 'https://elsewhere.example' },
      body: '',
    }));
    assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
  });

  for (const status of [401, 403, 429]) {
    it(`rejects an endpoint answering ${status}`, async () => {
      const url = await serve(() => ({ status, body: JSON.stringify({ error: 'nope' }) }));
      assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
    });
  }

  it('rejects a healthy node that is simply on a different chain', async () => {
    const url = await serve((method) => {
      if (method === 'eth_chainId') return { body: jsonRpc('0x1') };
      if (method === 'eth_blockNumber') return { body: jsonRpc('0x123456') };
      return { body: jsonRpc('0x3b9aca00') };
    });
    assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
  });

  it('rejects a node whose chain id is not parseable hex', async () => {
    const url = await serve((method) =>
      method === 'eth_chainId' ? { body: jsonRpc('not-a-number') } : { body: jsonRpc('0x1') },
    );
    assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
  });

  it('rejects a node that reports the right chain but rate-limits eth_blockNumber', async () => {
    const url = await serve((method) => {
      if (method === 'eth_chainId') return { body: jsonRpc('0xaa36a7') };
      if (method === 'eth_blockNumber') {
        return {
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: '0x1',
            error: { message: 'Your free plan rate limit was exceeded' },
          }),
        };
      }
      return { body: jsonRpc('0x1') };
    });
    assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
  });

  // Endpoints that serve the cheap reads free and gate what a wallet needs — probing only
  // eth_chainId would wave every one of these through.
  for (const gated of ['eth_getBalance', 'eth_estimateGas'] as const) {
    it(`rejects an endpoint that serves the cheap reads but paywalls ${gated}`, async () => {
      const url = await serve((method) => {
        if (method === 'eth_chainId') return { body: jsonRpc('0xaa36a7') };
        if (method === gated) {
          return {
            status: 402,
            body: JSON.stringify({ statusCode: 402, message: 'Payment required for this method' }),
          };
        }
        return { body: jsonRpc('0x1') };
      });
      assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
    });
  }

  for (const status of [402, 407, 451] as const) {
    it(`rejects an endpoint answering ${status}`, async () => {
      const url = await serve(() => ({ status, body: JSON.stringify({ message: 'nope' }) }));
      assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
    });
  }

  // These arrive as HTTP 200 with an `error` body, so status codes alone never catch them.
  for (const message of [
    'missing credentials for this endpoint',
    'authentication required',
    'please upgrade to a paid plan',
    'monthly quota exceeded',
    'You have exceeded your limit of 5 requests per minute',
  ]) {
    it(`rejects a 200 response whose error body says: ${message}`, async () => {
      const url = await serve((method) => {
        if (method === 'eth_chainId') return { body: jsonRpc('0xaa36a7') };
        return { body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1', error: { message } }) };
      });
      assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
    });
  }

  it('rejects an endpoint that answers every read but returns no result for eth_estimateGas', async () => {
    const url = await serve((method) => {
      if (method === 'eth_chainId') return { body: jsonRpc('0xaa36a7') };
      if (method === 'eth_estimateGas') return { body: JSON.stringify({ jsonrpc: '2.0', id: 1 }) };
      return { body: jsonRpc('0x1') };
    });
    assert.equal(await probeEvmRpc(url, CHAIN_ID), false);
  });

  it('returns false instead of throwing on an unreachable or malformed URL', async () => {
    assert.equal(await probeEvmRpc('not a url at all', CHAIN_ID), false);
    assert.equal(await probeEvmRpc('http://127.0.0.1:1/', CHAIN_ID, 1_000), false);
  });
});

describe('waitForEthTransactionMined with an injected requester', () => {
  const txHash = `0x${'ab'.repeat(32)}`;

  it('polls pending receipts and returns success without touching an HTTP RPC', async () => {
    let calls = 0;
    const requester: EvmRpcRequester = {
      async request(args) {
        assert.equal(args.method, 'eth_getTransactionReceipt');
        assert.deepEqual(args.params, [txHash]);
        calls += 1;
        return calls === 1 ? null : { status: '0x1' };
      },
    };

    assert.equal(
      await waitForEthTransactionMined(txHash, {
        requester,
        rpcUrl: 'http://127.0.0.1:1/should-not-be-used',
        pollIntervalMs: 1,
      }),
      'success',
    );
    assert.equal(calls, 2);
  });

  it('reports a reverted injected-provider receipt', async () => {
    const requester: EvmRpcRequester = {
      async request() {
        return { status: '0x0' };
      },
    };
    assert.equal(await waitForEthTransactionMined(txHash, { requester }), 'reverted');
  });

  it('times out when the injected provider never returns a receipt', async () => {
    const requester: EvmRpcRequester = {
      async request() {
        return null;
      },
    };
    await assert.rejects(
      waitForEthTransactionMined(txHash, { requester, timeoutMs: 5, pollIntervalMs: 1 }),
      /not mined within 5ms/,
    );
  });

  it('fails immediately when the injected provider rejects the receipt request', async () => {
    const requester: EvmRpcRequester = {
      async request() {
        throw new Error('provider unavailable');
      },
    };
    await assert.rejects(
      waitForEthTransactionMined(txHash, {
        requester,
        timeoutMs: 60_000,
        pollIntervalMs: 10_000,
      }),
      /RPC failed.*provider unavailable/,
    );
  });

  it('requires an explicit requester, network, or RPC URL', async () => {
    await assert.rejects(waitForEthTransactionMined(txHash), /needs an injected `requester`/);
  });
});
