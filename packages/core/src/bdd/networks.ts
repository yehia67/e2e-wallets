import type { Chain, StacksNetwork, SupportedStacksNetwork } from '../index.js';

// Re-exported so `@wallets-e2e/core/bdd` consumers keep importing it from where they always have.
export type { SupportedStacksNetwork };

/**
 * The chain words a `.feature` sentence may use. Stacks-only even though `Chain` includes `'evm'`:
 * these steps resolve Stacks network words and poll a Stacks API, so accepting "Ethereum" would
 * parse and then do the wrong thing.
 */
const CHAIN_WORDS: Readonly<Record<string, Chain>> = {
  stacks: 'stacks',
};

/** Shorter than `StacksNetwork` on purpose: the two outcomes Stacks drivers can honour today. */
const NETWORK_WORDS: Readonly<Record<string, SupportedStacksNetwork>> = {
  mainnet: 'mainnet',
  testnet: 'testnet4',
  testnet4: 'testnet4',
};

/** Real networks no wallet step can reach yet. Listed apart so they get "not supported yet". */
const UNSUPPORTED_NETWORK_WORDS: readonly StacksNetwork[] = ['testnet3', 'signet', 'devnet'];

/** What a chain/network phrase in a Gherkin sentence resolves to. */
export interface ParsedNetworkPhrase {
  chain: Chain;
  network: SupportedStacksNetwork;
}

/**
 * `('Stacks', 'testnet')` -> `{ chain: 'stacks', network: 'testnet4' }`. Case- and
 * whitespace-tolerant, since the input is human prose; unknown words throw before anything launches.
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
        `a wallet on it yet: these steps only ever hand switchNetwork() mainnet or testnet4. ` +
        `Supported for now: ${Object.keys(NETWORK_WORDS).join(', ')}.`,
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
