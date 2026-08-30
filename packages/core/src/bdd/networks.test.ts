import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Imported with an explicit `.ts` extension because this file is executed by `node --test`
// directly from source (Node's built-in type stripping) — there is no build step in front of it,
// and Node does not remap a `.js` specifier onto a `.ts` file. This test is excluded from the
// package build, so the extension never reaches `dist/`.
import { parseNetworkPhrase } from './networks.ts';

describe('parseNetworkPhrase', () => {
  it('resolves the sentence a .feature actually contains', () => {
    // "Given I am connected to Stacks testnet" — the row the whole feature exists for.
    assert.deepEqual(parseNetworkPhrase('Stacks', 'testnet'), {
      chain: 'stacks',
      network: 'testnet4',
    });
  });

  it('maps the bare word "testnet" onto testnet4, not a literal "testnet"', () => {
    assert.equal(parseNetworkPhrase('Stacks', 'testnet').network, 'testnet4');
  });

  it('accepts every network a driver can actually be put on', () => {
    for (const network of ['mainnet', 'testnet4'] as const) {
      assert.equal(parseNetworkPhrase('Stacks', network).network, network);
    }
  });

  it('is case-insensitive and tolerates stray whitespace', () => {
    assert.deepEqual(parseNetworkPhrase('  STACKS ', ' TestNet4 '), {
      chain: 'stacks',
      network: 'testnet4',
    });
  });

  it('throws on an unknown network word, naming it and listing what is valid', () => {
    assert.throws(
      () => parseNetworkPhrase('Stacks', 'banana'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /banana/);
        assert.match(error.message, /mainnet/);
        assert.match(error.message, /testnet4/);
        return true;
      },
    );
  });

  it('throws on an unknown chain word, naming it and listing what is valid', () => {
    assert.throws(
      () => parseNetworkPhrase('Ethereum', 'testnet'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Ethereum/);
        assert.match(error.message, /stacks/);
        return true;
      },
    );
  });

  it('rejects an unknown chain before it ever looks at the network', () => {
    // Both words are wrong; the chain error is the one a spec author needs to see first.
    assert.throws(() => parseNetworkPhrase('Ethereum', 'banana'), /Unknown chain/);
  });

  // The whole point of narrowing the vocabulary: these are real Stacks networks, so "unknown" would
  // be a lie — but no driver can reach them, and silently landing on testnet4 while the mined step
  // polls devnet's RPC is the failure mode this rejects.
  for (const network of ['devnet', 'signet', 'testnet3'] as const) {
    it(`rejects the real-but-unreachable network "${network}" as not supported yet`, () => {
      assert.throws(
        () => parseNetworkPhrase('Stacks', network),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, new RegExp(network));
          assert.match(error.message, /not put a wallet on it yet|switchNetwork/);
          // Must never read as an unrecognised word — it is a real network, just unwired.
          assert.doesNotMatch(error.message, /Unknown network/);
          return true;
        },
      );
    });
  }

  it('never resolves an inherited Object.prototype key as a chain or a network', () => {
    // A bare `CHAIN_WORDS[word]` lookup would hand back `Object` itself here.
    assert.throws(() => parseNetworkPhrase('constructor', 'testnet'), /Unknown chain/);
    assert.throws(() => parseNetworkPhrase('Stacks', 'constructor'), /Unknown network/);
    assert.throws(() => parseNetworkPhrase('Stacks', 'toString'), /Unknown network/);
  });
});
