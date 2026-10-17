import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { settleWrite, waitForSuccessfulReceipt } from './settle.ts';
import type { TxProbeState } from './tx-probe.ts';

const HASH = `0x${'cd'.repeat(32)}`;
const state: TxProbeState = { status: 'submitted', hash: HASH, error: '', userOpHash: HASH, operator: '0x1' };
const probe = { waitForHash: async () => HASH, read: async () => state };
const rpcAnswering = (answers: unknown[]) => ({ request: async () => answers.shift() ?? answers.at(-1) });

describe('waitForSuccessfulReceipt', () => {
  it('polls until the receipt is there and succeeded', async () => {
    const receipt = await waitForSuccessfulReceipt(rpcAnswering([null, null, { status: '0x1' }]), HASH, { pollMs: 1 });
    assert.deepEqual(receipt, { status: '0x1' });
  });

  it('retries through RPC errors and names the last one if the receipt never comes', async () => {
    let calls = 0;
    const flaky = { request: async () => { calls += 1; if (calls < 3) throw new Error('rate limited'); return { status: '0x1' }; } };
    assert.deepEqual(await waitForSuccessfulReceipt(flaky, HASH, { pollMs: 1 }), { status: '0x1' });
    const down = { request: async () => { throw new Error('node down'); } };
    await assert.rejects(() => waitForSuccessfulReceipt(down, HASH, { timeoutMs: 5, pollMs: 1 }), /Last RPC error: node down/);
  });

  it('fails at once on a reverted transaction and on a timeout', async () => {
    await assert.rejects(() => waitForSuccessfulReceipt(rpcAnswering([{ status: '0x0' }]), HASH, { pollMs: 1 }), /did not succeed: status 0x0/);
    await assert.rejects(() => waitForSuccessfulReceipt(rpcAnswering([null]), HASH, { timeoutMs: 5, pollMs: 1 }), /not mined within 5 ms/);
  });
});

describe('settleWrite', () => {
  it('runs the receipt check once and the state check until it holds', async () => {
    let verified = 0;
    let attempts = 0;
    const settled = await settleWrite({
      probe,
      rpc: rpcAnswering([{ status: '0x1' }]),
      verifyReceipt: async ({ hash, state: seen, receipt }) => { verified += 1; assert.equal(hash, HASH); assert.equal(seen.userOpHash, HASH); assert.deepEqual(receipt, { status: '0x1' }); },
      assertState: async () => { attempts += 1; if (attempts < 3) throw new Error('not yet'); },
      statePollMs: 1,
    });
    assert.deepEqual(settled, { hash: HASH, receipt: 'success', state });
    assert.equal(verified, 1);
    assert.equal(attempts, 3);
  });

  it('reports the last state failure when time runs out', async () => {
    await assert.rejects(() => settleWrite({
      probe,
      rpc: rpcAnswering([{ status: '0x1' }]),
      assertState: async () => { throw new Error('balance still 0'); },
      stateTimeoutMs: 5,
      statePollMs: 1,
    }), /never matched within 5 ms: balance still 0/);
  });

  it('does not reach the state check when the receipt check fails', async () => {
    let asserted = false;
    await assert.rejects(() => settleWrite({
      probe,
      rpc: rpcAnswering([{ status: '0x1' }]),
      verifyReceipt: async () => { throw new Error('not sponsored'); },
      assertState: async () => { asserted = true; },
    }), /not sponsored/);
    assert.equal(asserted, false);
  });
});
