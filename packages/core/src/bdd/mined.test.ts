import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension for the same reason as `networks.test.ts`: this file is run by
// `node --test` straight from source, and is excluded from the package build.
import { assertMinedStatus } from './mined.ts';

const TXID = '0x' + 'a'.repeat(64);

// Covers the "Mined assertion" row of the spec's I/O & Edge-Case Matrix: `Then the transaction is
// mined` must throw on `abort_by_*`. A real testnet run only ever returns `success`, so without
// these cases the branch is unreachable and deleting it would leave the whole suite green.
describe('assertMinedStatus', () => {
  it('passes a mined, successful transaction through silently', () => {
    assert.doesNotThrow(() => assertMinedStatus(TXID, 'success'));
  });

  it('throws on abort_by_response, naming the txid and the status', () => {
    assert.throws(
      () => assertMinedStatus(TXID, 'abort_by_response'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(TXID));
        assert.match(error.message, /abort_by_response/);
        assert.match(error.message, /did not succeed/);
        return true;
      },
    );
  });

  it('throws on abort_by_post_condition, naming the txid and the status', () => {
    assert.throws(
      () => assertMinedStatus(TXID, 'abort_by_post_condition'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(TXID));
        assert.match(error.message, /abort_by_post_condition/);
        assert.match(error.message, /post-condition/);
        return true;
      },
    );
  });

  it('explains each abort status differently, so the message is worth reading', () => {
    const messageFor = (status: 'abort_by_response' | 'abort_by_post_condition') => {
      try {
        assertMinedStatus(TXID, status);
      } catch (error) {
        return (error as Error).message;
      }
      return assert.fail(`assertMinedStatus should have thrown on "${status}"`);
    };
    assert.notEqual(messageFor('abort_by_response'), messageFor('abort_by_post_condition'));
  });

  it('treats any other non-success status as a failure too', () => {
    // `waitForTransactionMined` never returns these, but a caller passing one straight through
    // must not be silently accepted.
    assert.throws(() => assertMinedStatus(TXID, 'pending'), /did not succeed/);
    assert.throws(() => assertMinedStatus(TXID, 'not_found'), /did not succeed/);
  });
});
