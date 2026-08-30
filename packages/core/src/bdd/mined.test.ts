import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run by `node --test` straight from source, excluded from the build.
import { assertMinedStatus } from './mined.ts';

const TXID = '0x' + 'a'.repeat(64);

// A real testnet run only ever returns `success`, so these cases are the only cover the
// `abort_by_*` branch gets.
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
    assert.throws(() => assertMinedStatus(TXID, 'pending'), /did not succeed/);
    assert.throws(() => assertMinedStatus(TXID, 'not_found'), /did not succeed/);
  });
});
