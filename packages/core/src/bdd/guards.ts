import type { BrowserContext, WalletDriver } from '../index.js';
import type { SupportedStacksNetwork } from './networks.js';

// Preconditions every wallet step checks. Kept apart from `./index.ts` (the only module importing
// `playwright-bdd`) so `node --test` can exercise them without that optional peer installed.

/** `createBdd(undefined)` is legal and binds to stock fixtures, whose context has no extension. */
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
 * Left at the port's `never` network default: only the Stacks connect step uses a network, and
 * pinning this to `WalletDriver<SupportedStacksNetwork>` would reject an EVM driver registered
 * purely to reuse the approval steps.
 */
export type WalletStepsDriver = WalletDriver<never>;

export function requireDriver(driver: WalletStepsDriver | undefined): WalletStepsDriver {
  if (!driver) {
    throw new Error(
      `[@wallets-e2e/core/bdd] No wallet driver is registered, so this step cannot run. ` +
        `Call createWalletSteps({ test, driver, seedPhrase, walletName }) from your step-definition ` +
        `file — e.g. createWalletSteps({ test, driver: leatherDriver, seedPhrase, walletName: 'Leather' }).`,
    );
  }
  return driver;
}

export function requireSeedPhrase(seedPhrase: string | undefined): string {
  // Whitespace-only is as empty as `''` — both fail opaquely inside the extension otherwise.
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
 * Returns the requested network already bound into the driver's switch call, or `undefined` for
 * mainnet. Throws rather than no-ops when a driver has no switch verb: silently staying on the
 * wallet's mainnet default would sign a real-value transaction.
 */
export function requireNetworkSwitch(
  driver: WalletStepsDriver,
  network: SupportedStacksNetwork,
): ((context: BrowserContext) => Promise<void>) | undefined {
  if (network === 'mainnet') return undefined;

  if (
    typeof driver.switchNetwork !== 'function' &&
    typeof driver.switchToTestnetNetwork !== 'function'
  ) {
    throw new Error(
      `[@wallets-e2e/core/bdd] The step asked for "${network}", but this wallet driver does not ` +
        `implement switchNetwork() (or the legacy switchToTestnetNetwork()), so the wallet would ` +
        `silently stay on whatever network it ` +
        `defaults to — mainnet, for every wallet this project has seen. Refusing to continue ` +
        `rather than risk signing a real-value transaction. Implement switchNetwork() on the ` +
        `driver, or write the scenario as "connected to Stacks mainnet" if that is genuinely what ` +
        `you meant.`,
    );
  }

  if (typeof driver.switchNetwork !== 'function') {
    return driver.switchToTestnetNetwork!.bind(driver);
  }

  // The cast re-widens the port's deliberately-`never` network parameter (see `WalletStepsDriver`)
  // to what this Stacks-only sentence means; a driver that cannot accept it rejects it itself.
  const switchNetwork = driver.switchNetwork.bind(driver) as (
    context: BrowserContext,
    network: SupportedStacksNetwork,
  ) => Promise<void>;
  return (context: BrowserContext) => switchNetwork(context, network);
}
