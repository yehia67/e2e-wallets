import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Page } from '@playwright/test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { createTxProbe, describeFailure, isSettledTransition, parseProbeAttributes } from './tx-probe.ts';

const HASH = `0x${'ab'.repeat(32)}`;

/** A page whose probe element reads from `attributes`, and which remembers what was dispatched. */
function fakePage(attributes: Record<string, string | null>) {
  const dispatched: string[] = [];
  let bound: ((source: unknown, detail: unknown) => void) | undefined;
  const page = {
    getByTestId: () => ({ evaluate: async (_fn: unknown, names: string[]) => Object.fromEntries(names.map((name) => [name, attributes[name] ?? null])) }),
    evaluate: async (fn: unknown, arg: unknown) => {
      if (typeof arg === 'string') dispatched.push(arg);
    },
    exposeBinding: async (_name: string, fn: (source: unknown, detail: unknown) => void) => { bound = fn; },
    addInitScript: async () => undefined,
  } as unknown as Page;
  return { page, dispatched, emit: (detail: unknown) => bound?.({}, detail), attributes };
}

describe('parseProbeAttributes', () => {
  it('reads every attribute and leaves the ERC-4337 fields out when absent', () => {
    assert.deepEqual(parseProbeAttributes({ 'data-status': 'confirmed', 'data-hash': HASH, 'data-error': null }), {
      status: 'confirmed', hash: HASH, error: '',
    });
    assert.deepEqual(parseProbeAttributes({
      'data-status': 'confirmed', 'data-hash': HASH, 'data-user-op-hash': HASH, 'data-operator': '0x1', 'data-sponsored': 'true', 'data-block-number': '7',
    }), { status: 'confirmed', hash: HASH, error: '', userOpHash: HASH, operator: '0x1', sponsored: true, blockNumber: '7' });
  });

  it('reads a missing element as idle', () => {
    assert.deepEqual(parseProbeAttributes({}), { status: 'idle', hash: '', error: '' });
  });
});

describe('isSettledTransition / describeFailure', () => {
  it('counts only confirmed, sponsored operations with a hash', () => {
    assert.equal(isSettledTransition({ status: 'confirmed', sponsored: true, userOpHash: HASH, hash: HASH }), true);
    assert.equal(isSettledTransition({ status: 'confirmed', sponsored: false, userOpHash: HASH, hash: HASH }), false);
    assert.equal(isSettledTransition({ status: 'submitted', sponsored: true, userOpHash: HASH, hash: HASH }), false);
  });

  it('describes a failure with the app\'s own reason', () => {
    assert.equal(describeFailure({ error: 'AA24 signature error', hash: '' }), 'the app reported the write as failed: AA24 signature error (hash=none)');
    assert.equal(describeFailure({}), 'the app reported the write as failed: no reason recorded (hash=none)');
  });
});

describe('createTxProbe', () => {
  it('waitForHash returns the hash once submitted and fails fast on a failed write', async () => {
    const { page, attributes } = fakePage({ 'data-status': 'pending', 'data-hash': '' });
    const probe = createTxProbe(page, { pollMs: 1 });
    setTimeout(() => { attributes['data-status'] = 'submitted'; attributes['data-hash'] = HASH; }, 5);
    assert.equal(await probe.waitForHash({ timeoutMs: 1_000 }), HASH);

    attributes['data-status'] = 'failed';
    attributes['data-error'] = 'Do not resend';
    await assert.rejects(() => probe.waitForHash({ timeoutMs: 1_000 }), /failed: Do not resend/);
  });

  it('clear dispatches the prefixed event and waits for idle', async () => {
    const { page, dispatched, attributes } = fakePage({ 'data-status': 'confirmed' });
    const probe = createTxProbe(page, { eventPrefix: 'trex', pollMs: 1 });
    setTimeout(() => { attributes['data-status'] = 'idle'; }, 5);
    await probe.clear({ timeoutMs: 1_000 });
    assert.deepEqual(dispatched, ['trex:clear-last-tx']);
  });

  it('captureAll records settled writes once each and surfaces a failure', async () => {
    const { page, emit } = fakePage({});
    const probe = createTxProbe(page, { pollMs: 1 });
    await probe.captureAll();
    emit({ status: 'pending', hash: '' });
    emit({ status: 'confirmed', hash: HASH, userOpHash: HASH, operator: '0x1', sponsored: true });
    emit({ status: 'confirmed', hash: HASH, userOpHash: HASH, operator: '0x1', sponsored: true });
    assert.equal(probe.captured().length, 1);
    assert.equal((await probe.waitForCaptured(0, { timeoutMs: 100 })).hash, HASH);
    emit({ status: 'failed', error: 'reverted', hash: '' });
    await assert.rejects(() => probe.waitForCaptured(1, { timeoutMs: 100 }), /failed: reverted/);
  });
});
