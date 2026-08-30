import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run by `node --test` straight from source, excluded from the build.
import {
  queueWalletTrigger,
  recordTransactionId,
  requireTransactionId,
  resetWalletState,
  setWalletNetwork,
  takeWalletTrigger,
  walletNetwork,
} from './state.ts';
import type { BrowserContext } from '../index.js';

// The context is only ever a WeakMap key, never called into, so a bare object stands in for one.
function fakeContext(): BrowserContext {
  return {} as unknown as BrowserContext;
}

const TXID = 'a'.repeat(64);

describe('queueWalletTrigger / takeWalletTrigger', () => {
  it('hands back exactly the queued action', async () => {
    const context = fakeContext();
    const trigger = async () => {};
    queueWalletTrigger(context, trigger);
    assert.equal(takeWalletTrigger(context), trigger);
  });

  it('consumes the action one-shot, so a second approval cannot silently re-run it', () => {
    const context = fakeContext();
    queueWalletTrigger(context, async () => {});
    takeWalletTrigger(context);
    // Without the clear, this second take would return the first scenario's action and pass.
    assert.throws(() => takeWalletTrigger(context), /no pending wallet action/);
  });

  it('names queueWalletTrigger when nothing was queued, rather than timing out later', () => {
    assert.throws(
      () => takeWalletTrigger(fakeContext()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /no pending wallet action/);
        assert.match(error.message, /queueWalletTrigger/);
        assert.match(error.message, /trigger\(\)/);
        return true;
      },
    );
  });

  it('refuses a second queue while one is still pending instead of dropping the first', () => {
    const context = fakeContext();
    const first = async () => {};
    queueWalletTrigger(context, first);
    assert.throws(() => queueWalletTrigger(context, async () => {}), /already queued/);
    assert.equal(takeWalletTrigger(context), first);
  });

  it('allows a fresh queue once the previous action has been approved', () => {
    const context = fakeContext();
    queueWalletTrigger(context, async () => {});
    takeWalletTrigger(context);
    const second = async () => {};
    queueWalletTrigger(context, second);
    assert.equal(takeWalletTrigger(context), second);
  });

  it('keeps two contexts independent of each other', () => {
    const a = fakeContext();
    const b = fakeContext();
    const triggerA = async () => {};
    queueWalletTrigger(a, triggerA);
    assert.throws(() => takeWalletTrigger(b), /no pending wallet action/);
    assert.equal(takeWalletTrigger(a), triggerA);
  });
});

describe('recordTransactionId / requireTransactionId', () => {
  it('round-trips a txid, trimming surrounding whitespace', () => {
    const context = fakeContext();
    recordTransactionId(context, `  ${TXID}  `);
    assert.equal(requireTransactionId(context), TXID);
  });

  it('accepts the 0x-prefixed form as well as the bare one @stacks/connect returns', () => {
    const context = fakeContext();
    recordTransactionId(context, `0x${TXID}`);
    assert.equal(requireTransactionId(context), `0x${TXID}`);
  });

  it('names recordTransactionId when nothing was recorded', () => {
    assert.throws(
      () => requireTransactionId(fakeContext()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /no transaction id recorded/);
        assert.match(error.message, /recordTransactionId/);
        return true;
      },
    );
  });

  it('rejects a malformed txid where it was scraped, not 15 minutes into a poll', () => {
    const context = fakeContext();
    // The exact failure this guards: a locator that matched a label instead of the value.
    assert.throws(() => recordTransactionId(context, `txid: ${TXID}`), /not a Stacks transaction id/);
    assert.throws(() => recordTransactionId(context, ''), /not a Stacks transaction id/);
    assert.throws(() => recordTransactionId(context, 'a'.repeat(63)), /not a Stacks transaction id/);
    assert.throws(() => recordTransactionId(context, 'z'.repeat(64)), /not a Stacks transaction id/);
    assert.throws(() => requireTransactionId(context), /no transaction id recorded/);
  });

  it('refuses a second record rather than silently dropping the first txid', () => {
    const context = fakeContext();
    recordTransactionId(context, TXID);
    const other = 'b'.repeat(64);
    assert.throws(() => recordTransactionId(context, other), /already recorded/);
    assert.equal(requireTransactionId(context), TXID);
  });
});

describe('resetWalletState', () => {
  it('drops a stale txid, network and queued action from a reused context', () => {
    // The exact leak a worker-scoped context would produce between scenarios.
    const context = fakeContext();
    recordTransactionId(context, TXID);
    setWalletNetwork(context, 'testnet4');
    queueWalletTrigger(context, async () => {});

    resetWalletState(context);

    assert.equal(walletNetwork(context), undefined);
    assert.throws(() => requireTransactionId(context), /no transaction id recorded/);
    assert.throws(() => takeWalletTrigger(context), /no pending wallet action/);
  });
});

describe('setWalletNetwork / walletNetwork', () => {
  it('reports nothing until the connect step has run', () => {
    assert.equal(walletNetwork(fakeContext()), undefined);
  });

  it('reports the network the connect step resolved', () => {
    const context = fakeContext();
    setWalletNetwork(context, 'mainnet');
    assert.equal(walletNetwork(context), 'mainnet');
  });
});
