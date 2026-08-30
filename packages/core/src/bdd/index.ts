import type { TestType } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import type { BrowserContext, Page } from '../index.js';
import {
  STACKS_NETWORK_RPC_URLS,
  selectWalletInStacksConnectModal,
  waitForTransactionMined,
} from '../index.js';
import {
  requireDriver,
  requireNetworkSwitch,
  requireSeedPhrase,
  requireTest,
} from './guards.js';
import type { WalletStepsDriver } from './guards.js';
import { assertMinedStatus } from './mined.js';
import { parseNetworkPhrase } from './networks.js';
import {
  requireTransactionId,
  resetWalletState,
  setWalletNetwork,
  takeWalletTrigger,
  walletNetwork,
} from './state.js';

export { parseNetworkPhrase } from './networks.js';
export type { ParsedNetworkPhrase, SupportedStacksNetwork } from './networks.js';
export { queueWalletTrigger, recordTransactionId, takeWalletTrigger } from './state.js';
export type { WalletTrigger } from './state.js';

/** Deliberately loose: this library only reads the two built-ins every Playwright test has. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WalletStepsTest = TestType<any, any>;

interface WalletStepFixtures {
  /** The persistent, extension-loaded context — the one `launchContext()` returned, not the stock fixture. */
  context: BrowserContext;
  page: Page;
}

export interface CreateWalletStepsOptions {
  /** The `test` carrying your extension-context fixtures, extended from `playwright-bdd`'s `test`. */
  test: WalletStepsTest;
  /** The wallet adapter these steps drive. Injected, because core cannot depend on a wallet package. */
  driver: WalletStepsDriver;
  /** Seed phrase the wallet is imported from. Read it from an env-var-backed fixture. */
  seedPhrase: string;
  /** The wallet's name as `@stacks/connect`'s picker lists it, e.g. `'Leather'`. */
  walletName: string;
  /** `data-testid` of the dapp's own connect button. Ignored when `connect` is supplied. */
  connectTestId?: string;
  /** How the dapp reaches the wallet's connection popup. Runs *inside* the driver's `trigger()`. */
  connect?: (page: Page) => Promise<void>;
  /** Stacks API the `transaction is mined` step polls. Defaults to the parsed network's RPC URL. */
  rpcUrl?: string;
  /**
   * How long that step polls for. Defaults to 15 minutes, far above Playwright's own test timeout —
   * a scenario using it needs a matching `@timeout:` tag.
   */
  minedTimeoutMs?: number;
}

/**
 * Registers the coarse, wallet-agnostic Gherkin steps and hands back the same `Given`/`When`/`Then`
 * binders for the consumer's own dapp steps.
 *
 * ```ts
 * export const { Given, When, Then } = createWalletSteps({
 *   test,
 *   driver: leatherDriver,
 *   seedPhrase: wallet.seedPhrase,
 *   walletName: 'Leather',
 * });
 * ```
 */
export function createWalletSteps(options: CreateWalletStepsOptions) {
  const {
    test,
    driver,
    seedPhrase,
    walletName,
    connectTestId = 'connect-wallet',
    connect,
    rpcUrl,
    minedTimeoutMs = 15 * 60 * 1000,
  } = options;

  // Checked at registration, not per step, so wiring mistakes surface when the step file loads.
  const bdd = createBdd(requireTest(test));
  const { Given, When, Then } = bdd;

  if (!walletName?.trim()) {
    throw new Error(
      `[@wallets-e2e/core/bdd] createWalletSteps({ walletName }) needs the wallet's name as ` +
        `@stacks/connect lists it (e.g. 'Leather'). An empty walletName cannot select a picker entry.`,
    );
  }

  if (!(minedTimeoutMs > 0)) {
    throw new Error(
      `[@wallets-e2e/core/bdd] createWalletSteps({ minedTimeoutMs }) must be a positive number of ` +
        `milliseconds (got ${String(minedTimeoutMs)}).`,
    );
  }

  const runConnectTrigger =
    connect ??
    (async (page: Page) => {
      await page.getByTestId(connectTestId).click();
      // `@stacks/connect` shows its own in-page picker before the extension popup.
      await selectWalletInStacksConnectModal(page, walletName);
    });

  // Import, network switch and dapp connection as one unit — the dapp's connect click has to live
  // inside `connectToDapp`'s trigger callback or the popup opens before anyone is listening.
  Given(
    'I am connected to {word} {word}',
    async ({ context, page }: WalletStepFixtures, chainWord: string, networkWord: string) => {
      // Parse first: a bad word fails before a browser or an extension has been touched.
      const { network } = parseNetworkPhrase(chainWord, networkWord);
      const wallet = requireDriver(driver);
      const phrase = requireSeedPhrase(seedPhrase);

      // Resolved before the import: a driver that cannot leave mainnet must not run a testnet
      // scenario, and refusing early costs nothing.
      const switchNetwork = requireNetworkSwitch(wallet, network);

      // Clean start even when the consuming project scopes its context to the worker, not the test.
      resetWalletState(context);
      setWalletNetwork(context, network);

      await wallet.importWallet(context, phrase);
      await switchNetwork?.(context);

      // Only navigate from about:blank, so a project that already routes its own dapp keeps control.
      if (page.url() === 'about:blank') {
        await page.goto('/');
      }

      await wallet.connectToDapp(context, async () => {
        await runConnectTrigger(page);
      });
    },
  );

  // Approves whatever popup the *queued* dapp action opens, running it inside `trigger()`.
  When('I approve the wallet popup', async ({ context }: WalletStepFixtures) => {
    const wallet = requireDriver(driver);
    const trigger = takeWalletTrigger(context);
    await wallet.confirmTransaction(context, trigger);
  });

  When('I approve the wallet signature popup', async ({ context }: WalletStepFixtures) => {
    const wallet = requireDriver(driver);
    if (!wallet.confirmSignature) {
      throw new Error(
        `[@wallets-e2e/core/bdd] Driver has no confirmSignature() — EIP-712 / permit flows need it.`,
      );
    }
    const trigger = takeWalletTrigger(context);
    await wallet.confirmSignature(context, trigger);
  });

  // "The popup closed" is never proof a transaction landed — this polls the chain for real.
  Then('the transaction is mined', async ({ context }: WalletStepFixtures) => {
    const txid = requireTransactionId(context);
    const network = walletNetwork(context);
    // No default: falling back to testnet4 would poll the wrong chain for a tx that never appears.
    const resolvedRpcUrl = rpcUrl ?? (network && STACKS_NETWORK_RPC_URLS[network]);
    if (!resolvedRpcUrl) {
      throw new Error(
        `[@wallets-e2e/core/bdd] "the transaction is mined" ran with no network recorded and no ` +
          `rpcUrl override. Run "I am connected to ..." first, or pass rpcUrl to createWalletSteps.`,
      );
    }

    const status = await waitForTransactionMined(txid, {
      rpcUrl: resolvedRpcUrl,
      timeoutMs: minedTimeoutMs,
    });

    assertMinedStatus(txid, status);
  });

  return bdd;
}
