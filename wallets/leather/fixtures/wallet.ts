import { CHAIN, STACKS_NETWORK_RPC_URLS, type StacksNetwork } from '@wallets-e2e/core';

const NETWORK: StacksNetwork = 'testnet4';

// Safe, checked-in default -- has never held, and will never hold, anything of real value. Exists
// purely so `pnpm test` works out of the box with no setup. Never a real-value seed.
const DEFAULT_SEED_PHRASE =
  'borrow poverty valid fee tape access zebra sustain luxury buddy account only prepare nasty van rotate wool farm region brave season half relax donkey';
// Both addresses derive from the same key (only the network version byte differs) -- verified two
// independent ways: (1) computed via @stacks/wallet-sdk's generateWallet + @stacks/transactions'
// getAddressFromPrivateKey, and (2) cross-checked against Leather's own persisted
// chrome.storage.local after a real unlock, which surfaces the mainnet form directly.
const DEFAULT_MAINNET_ADDRESS = 'SP1QM4Q2BM7SXWTECDSJB7SAEBMQQN741F2CJ4KFN';
const DEFAULT_TESTNET_ADDRESS = 'ST1QM4Q2BM7SXWTECDSJB7SAEBMQQN741F32V9N05';
// Leather enforces a minimum password-strength meter on /set-password -- this exact value is
// verified (by direct inspection) to clear it. Content is arbitrary; only the strength matters.
const DEFAULT_PASSWORD = 'DevnetOnly-Fixture-Wallet-2026!';

/**
 * The wallet Leather unlocks with, NFR1 / AD-5. Real account secret keys are never hardcoded as
 * the only option: every field below reads from an environment variable first, falling back to
 * this repo's safe, checked-in, no-value default. Point your own tests at your own account by
 * setting `WALLETS_E2E_SEED_PHRASE` (and the matching `WALLETS_E2E_MAINNET_ADDRESS` /
 * `WALLETS_E2E_TESTNET_ADDRESS` -- `importWallet`'s real verification step checks the unlocked
 * account's address against `mainnetAddress`, so an overridden seed needs its real matching
 * address too, or it fails loudly rather than silently trusting an unverified value).
 *
 * `chain`/`network`/`rpcUrl` name exactly which network this fixture is meant for -- real testnet
 * today (a local Clarinet devnet was tried first and dropped, see `packages/core`'s
 * `TESTNET_RPC_URL` doc comment for why).
 */
export const wallet = {
  chain: CHAIN,
  network: NETWORK,
  rpcUrl: STACKS_NETWORK_RPC_URLS[NETWORK],
  seedPhrase: process.env.WALLETS_E2E_SEED_PHRASE ?? DEFAULT_SEED_PHRASE,
  mainnetAddress: process.env.WALLETS_E2E_MAINNET_ADDRESS ?? DEFAULT_MAINNET_ADDRESS,
  testnetAddress: process.env.WALLETS_E2E_TESTNET_ADDRESS ?? DEFAULT_TESTNET_ADDRESS,
  password: process.env.WALLETS_E2E_PASSWORD ?? DEFAULT_PASSWORD,
};
