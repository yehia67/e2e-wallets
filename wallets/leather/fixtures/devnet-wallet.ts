/**
 * Devnet-only fixture wallet. NFR1 / AD-5.
 *
 * This seed phrase was generated fresh for this repo, has never held any real value, and is only
 * ever used to unlock a Leather instance pointed at a local Clarinet devnet. Never put a
 * real-value seed phrase here, and never source this value from an environment variable — it
 * must live checked in, in the clear, so anyone can audit exactly what it is.
 *
 * The `address` below is the devnet (testnet-format, "ST…") address this seed phrase derives to
 * and is what `1-1-load-and-unlock.spec.ts` asserts Leather reports after unlocking.
 */
export const devnetWallet = {
  seedPhrase:
    'borrow poverty valid fee tape access zebra sustain luxury buddy account only prepare nasty van rotate wool farm region brave season half relax donkey',
  // Both addresses derive from the same key (only the network version byte differs) — verified two
  // independent ways: (1) computed via @stacks/wallet-sdk's generateWallet + @stacks/transactions'
  // getAddressFromPrivateKey, and (2) cross-checked against Leather's own persisted
  // chrome.storage.local after a real unlock, which surfaces the mainnet form directly. Story 1.1's
  // driver asserts against `mainnetAddress` because that's what Leather's storage actually exposes;
  // `devnetAddress` is the ST-prefixed form Stories 1.2+ use once real devnet transactions start.
  mainnetAddress: 'SP1QM4Q2BM7SXWTECDSJB7SAEBMQQN741F2CJ4KFN',
  devnetAddress: 'ST1QM4Q2BM7SXWTECDSJB7SAEBMQQN741F32V9N05',
  // Leather enforces a minimum password-strength meter on /set-password — a weak password (e.g.
  // "password1") leaves the Continue button permanently disabled ("Password strength: Poor").
  // Confirmed by direct inspection of the real onboarding flow; this value reaches "Continue"-enabling
  // strength there. Still devnet-only, still holds no real value.
  password: 'DevnetOnly-Fixture-Wallet-2026!',
} as const;
