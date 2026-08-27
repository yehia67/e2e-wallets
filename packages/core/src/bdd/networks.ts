import type { Chain, StacksNetwork } from '../index.js';

/**
 * The chain words a `.feature` sentence may use, mapped onto core's `Chain`. This is a *sentence
 * vocabulary*, deliberately separate from `CHAIN` itself: what a product owner types in Gherkin
 * ("Stacks") and what the code calls the chain ("stacks") are allowed to drift apart, and a second
 * chain would add a word here rather than change `CHAIN`. Typed against `Chain` so a value that
 * isn't a real chain fails to compile.
 */
const CHAIN_WORDS: Readonly<Record<string, Chain>> = {
  stacks: 'stacks',
};

/**
 * The networks a `WalletDriver` can actually be put on today, and the sentence words that reach
 * them.
 *
 * This list is deliberately shorter than `StacksNetwork`. The driver port offers exactly one
 * network operation — `switchToTestnetNetwork` — so `mainnet` (leave the wallet alone) and
 * `testnet4` (call it) are the only two outcomes any driver can honour. `testnet` is the word a
 * human actually writes and resolves to `testnet4`, the preset Leather's own picker offers and the
 * one this project's tests are proven against.
 */
const NETWORK_WORDS: Readonly<Record<string, SupportedStacksNetwork>> = {
  mainnet: 'mainnet',
  testnet: 'testnet4',
  testnet4: 'testnet4',
};

/**
 * Real Stacks networks that this project recognises but cannot yet put a wallet on. They are
 * listed separately, and rejected with their own message, so `Given I am connected to Stacks
 * devnet` says "not supported yet" instead of either "unknown network" (wrong — devnet is real) or,
 * far worse, silently switching the wallet to testnet4 while the mined step polls devnet's RPC.
 */
const UNSUPPORTED_NETWORK_WORDS: readonly StacksNetwork[] = ['testnet3', 'signet', 'devnet'];

/**
 * The subset of `StacksNetwork` a `WalletDriver` can actually be placed on. Narrower than
 * `StacksNetwork` on purpose — see `NETWORK_WORDS`.
 */
export type SupportedStacksNetwork = Extract<StacksNetwork, 'mainnet' | 'testnet4'>;

/** What a chain/network phrase in a Gherkin sentence resolves to. */
export interface ParsedNetworkPhrase {
  chain: Chain;
  network: SupportedStacksNetwork;
}

/**
 * Turns the two words of `Given I am connected to <chain> <network>` into the chain/network pair
 * the wallet steps actually operate on — `('Stacks', 'testnet')` -> `{ chain: 'stacks', network:
 * 'testnet4' }`.
 *
 * Case-insensitive and whitespace-tolerant, because the input is prose written by a human, not an
 * identifier. Unknown or unsupported words throw here — before anything is launched — naming the
 * offending word and listing what is accepted, so a bad `.feature` line fails in milliseconds with
 * a readable message rather than somewhere deep inside a browser launch.
 */
export function parseNetworkPhrase(chain: string, network: string): ParsedNetworkPhrase {
  const chainWord = chain.trim().toLowerCase();
  const networkWord = network.trim().toLowerCase();

  // `Object.hasOwn`, never a bare lookup: `parseNetworkPhrase('constructor', ...)` would otherwise
  // walk up to `Object.prototype` and hand back a function as the chain.
  if (!Object.hasOwn(CHAIN_WORDS, chainWord)) {
    throw new Error(
      `[@wallets-e2e/core/bdd] Unknown chain "${chain}" in a wallet step. ` +
        `Valid chains: ${Object.keys(CHAIN_WORDS).join(', ')}.`,
    );
  }

  if (UNSUPPORTED_NETWORK_WORDS.includes(networkWord as StacksNetwork)) {
    throw new Error(
      `[@wallets-e2e/core/bdd] The Stacks network "${network}" is real, but no wallet step can put ` +
        `a wallet on it yet: the WalletDriver port only offers switchToTestnetNetwork(), which ` +
        `reaches testnet4. Supported for now: ${Object.keys(NETWORK_WORDS).join(', ')}.`,
    );
  }

  if (!Object.hasOwn(NETWORK_WORDS, networkWord)) {
    throw new Error(
      `[@wallets-e2e/core/bdd] Unknown network "${network}" in a wallet step. ` +
        `Valid networks: ${Object.keys(NETWORK_WORDS).join(', ')} ` +
        `(not yet supported: ${UNSUPPORTED_NETWORK_WORDS.join(', ')}).`,
    );
  }

  return { chain: CHAIN_WORDS[chainWord], network: NETWORK_WORDS[networkWord] };
}
