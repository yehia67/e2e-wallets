import type { BrowserContext, WalletDriver } from '../index.js';
import type { SupportedStacksNetwork } from './networks.js';

/**
 * The preconditions every wallet step checks before it does anything. They live in their own
 * module — apart from `./index.ts`, which imports `playwright-bdd` — so they can be unit-tested by
 * `node --test` without a browser, a Playwright runner, or that optional peer dependency being
 * installed at all.
 *
 * `CreateWalletStepsOptions` types `test`, `driver`, `seedPhrase` and `walletName` as required, so
 * for a TypeScript consumer these are compile errors first. The runtime checks stay because the
 * type cannot see every caller: a plain-JavaScript step file, a `driver` import that resolves to
 * `undefined` through a module cycle, or an env-backed `seedPhrase` that is simply unset all reach
 * here with the types satisfied. The spec's I/O matrix requires the runtime throw as well.
 */

/**
 * The steps must be bound to the `test` that carries the extension-context fixtures.
 * `createBdd(undefined)` is legal in playwright-bdd and silently binds to Playwright's stock
 * fixtures — a context with no extension in it — which then fails as an opaque 10-second timeout
 * inside `importWallet` rather than as a wiring mistake.
 */
export function requireTest<T>(test: T | undefined): T {
  if (!test) {
    throw new Error(
      `[@wallets-e2e/core/bdd] No Playwright test object was passed to createWalletSteps({ test }). ` +
        `Pass the \`test\` your extension-context fixtures are defined on (extended from ` +
        `"playwright-bdd", not "@playwright/test") — without it the steps bind to Playwright's ` +
        `stock fixtures, whose browser context has no extension loaded.`,
    );
  }
  return test;
}

/**
 * A step cannot drive a wallet nobody registered. Thrown eagerly, before any browser work, and
 * naming the exact call the consumer is missing — the failure otherwise surfaces as an
 * undefined-property error deep inside a step, which says nothing about what to fix.
 */
export function requireDriver(driver: WalletDriver | undefined): WalletDriver {
  if (!driver) {
    throw new Error(
      `[@wallets-e2e/core/bdd] No wallet driver is registered, so this step cannot run. ` +
        `Call createWalletSteps({ test, driver, seedPhrase, walletName }) from your step-definition ` +
        `file — e.g. createWalletSteps({ test, driver: leatherDriver, seedPhrase, walletName: 'Leather' }).`,
    );
  }
  return driver;
}

/**
 * Same shape for the seed phrase. The message deliberately repeats the env-var rule (AD-5): the
 * quickest fix for this error is to paste a phrase inline, which is exactly the wrong one.
 */
export function requireSeedPhrase(seedPhrase: string | undefined): string {
  // Whitespace-only is as empty as `''` — both would reach `importWallet` and fail opaquely inside
  // the extension rather than as a named wiring mistake here.
  const trimmed = seedPhrase?.trim();
  if (!trimmed) {
    throw new Error(
      `[@wallets-e2e/core/bdd] No seed phrase was supplied, so the wallet cannot be imported. ` +
        `Pass one to createWalletSteps({ seedPhrase }) — read it from an environment variable, ` +
        `never a real-value key committed to source.`,
    );
  }
  return trimmed;
}

/**
 * `switchToTestnetNetwork` is optional on the `WalletDriver` port, and optional-chaining the call
 * would let a driver without one no-op straight past a `Given I am connected to Stacks testnet` —
 * leaving the wallet wherever it defaults to, which for Leather is **mainnet**. The scenario would
 * then go on to sign a real transaction with real value against a mainnet account. Refusing to
 * continue is the only safe reading of that sentence.
 *
 * Returns the bound switch function for a non-mainnet network, or `undefined` when the sentence
 * asked for mainnet and no switch is wanted at all.
 */
export function requireNetworkSwitch(
  driver: WalletDriver,
  network: SupportedStacksNetwork,
): ((context: BrowserContext) => Promise<void>) | undefined {
  if (network === 'mainnet') return undefined;

  if (typeof driver.switchToTestnetNetwork !== 'function') {
    throw new Error(
      `[@wallets-e2e/core/bdd] The step asked for "${network}", but this wallet driver does not ` +
        `implement switchToTestnetNetwork(), so the wallet would silently stay on whatever network ` +
        `it defaults to — mainnet, for every wallet this project has seen. Refusing to continue ` +
        `rather than risk signing a real-value transaction. Implement switchToTestnetNetwork() on ` +
        `the driver, or write the scenario as "connected to Stacks mainnet" if that is genuinely ` +
        `what you meant.`,
    );
  }

  return driver.switchToTestnetNetwork.bind(driver);
}
