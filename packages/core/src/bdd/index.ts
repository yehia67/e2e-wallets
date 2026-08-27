import type { TestType } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import type { BrowserContext, Page, WalletDriver } from '../index.js';
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
export { queueWalletTrigger, recordTransactionId } from './state.js';
export type { WalletTrigger } from './state.js';

/**
 * A Playwright `test` object `createBdd()` can bind step definitions to. Deliberately loose: the
 * consuming project's `test` carries whatever extension fixtures it needs, and this library only
 * ever reads the two built-ins every Playwright test has (`context`, `page`). Narrowing this would
 * force every consumer to hand their exact fixture type in as a generic for no benefit.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WalletStepsTest = TestType<any, any>;

/** The two built-in fixtures every wallet step reads. */
interface WalletStepFixtures {
  /**
   * The persistent, extension-loaded context. The consuming project must override Playwright's
   * built-in `context` fixture with the one `launchContext()` returned — the default browser
   * context has no extension in it.
   */
  context: BrowserContext;
  /** The page the dapp under test is open on. */
  page: Page;
}

export interface CreateWalletStepsOptions {
  /**
   * The `test` object the generated `.feature` specs run on — i.e. the one carrying your
   * extension-context fixtures, extended from `playwright-bdd`'s `test` rather than
   * `@playwright/test`'s. Required: `createBdd(undefined)` is legal and would bind the steps to
   * Playwright's stock fixtures, whose context has no extension in it.
   */
  test: WalletStepsTest;
  /**
   * The wallet adapter these steps drive (`leatherDriver`, or any other `WalletDriver`). This
   * library never imports a wallet package itself — every wallet depends on core, so the reverse
   * would be circular. The driver is injected here instead.
   */
  driver: WalletDriver;
  /** Seed phrase the wallet is imported from. Read this from an env-var-backed fixture, never a real-value key in source. */
  seedPhrase: string;
  /**
   * The wallet's name as `@stacks/connect`'s own in-page picker lists it, e.g. `'Leather'`. Used by
   * the default `connect` only — a project that supplies its own `connect` never reaches it, but it
   * stays required so the common path cannot be half-configured.
   */
  walletName: string;
  /** `data-testid` of the dapp's own connect button. Ignored when `connect` is supplied. */
  connectTestId?: string;
  /**
   * Everything the dapp needs to do to reach the wallet's connection popup. Defaults to clicking
   * `connectTestId` and then picking `walletName` in `@stacks/connect`'s picker. Whatever this
   * does runs *inside* the driver's `trigger()` callback — see `createWalletSteps`' note.
   */
  connect?: (page: Page) => Promise<void>;
  /** Stacks API the `transaction is mined` step polls. Defaults to the RPC URL of the parsed network. */
  rpcUrl?: string;
  /**
   * How long that step polls for. Real testnet blocks run ~10 minutes; the default allows 15, which
   * is far above Playwright's own default test timeout — a scenario using `the transaction is
   * mined` needs a matching `@timeout:` tag, or Playwright kills the test long before the poll
   * gives up.
   */
  minedTimeoutMs?: number;
}

/**
 * Registers this project's coarse, wallet-agnostic Gherkin steps and hands back the same
 * `Given`/`When`/`Then` binders for the consumer's own dapp steps.
 *
 * The steps are coarse **on purpose**. `Given I am connected to Stacks testnet` performs the seed
 * import, the network switch and the dapp connection as one unit, because that is what a product
 * owner means by that sentence — and because splitting the dapp's connect click away from the
 * driver's `trigger()` callback reintroduces the popup-listener race the driver exists to hide
 * (see `queueWalletTrigger`). A `.feature` file written against these steps mentions no seed
 * phrase, no network switch, no extension path and no popup mechanics.
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

  // Checked here, at registration, not per step: a missing `test` is a wiring mistake that should
  // surface the moment the step file loads rather than as a timeout inside the first scenario.
  const bdd = createBdd(requireTest(test));
  const { Given, When, Then } = bdd;

  const runConnectTrigger =
    connect ??
    (async (page: Page) => {
      await page.getByTestId(connectTestId).click();
      // `@stacks/connect` shows its own in-page multi-wallet picker before the extension popup —
      // generic dapp-library UI, so core (not the driver) knows how to get past it.
      await selectWalletInStacksConnectModal(page, walletName);
    });

  // The one coarse step. Everything a human means by "I am connected to Stacks testnet" — import,
  // network switch, dapp connection — happens here, with the dapp's connect click living inside
  // `connectToDapp`'s trigger callback exactly as `examples/react-connect`'s fixture already does.
  Given(
    'I am connected to {word} {word}',
    async ({ context, page }: WalletStepFixtures, chainWord: string, networkWord: string) => {
      // Parse first: a bad word fails here, in milliseconds, before a browser or an extension has
      // been touched.
      const { network } = parseNetworkPhrase(chainWord, networkWord);
      const wallet = requireDriver(driver);
      const phrase = requireSeedPhrase(seedPhrase);

      // A wallet that cannot be switched off its mainnet default must not run a testnet scenario:
      // the scenario would go on to sign a real-value transaction. Resolved before the import so
      // the refusal costs nothing.
      const switchNetwork = requireNetworkSwitch(wallet, network);

      // This scenario starts clean even if the consuming project scopes its context to the worker
      // rather than the test — otherwise a previous scenario's txid or queued action leaks in.
      resetWalletState(context);
      setWalletNetwork(context, network);

      await wallet.importWallet(context, phrase);

      // Leather defaults to mainnet whatever network the dapp names, and an account with no
      // mainnet balance crashes its own fee estimation before any UI renders.
      await switchNetwork?.(context);

      // A stock Playwright `page` fixture starts on about:blank; navigate only in that case, so a
      // consuming project that already puts its dapp on screen keeps control of its own routing.
      if (page.url() === 'about:blank') {
        await page.goto('/');
      }

      await wallet.connectToDapp(context, async () => {
        await runConnectTrigger(page);
      });
    },
  );

  // Approves whatever popup the *queued* dapp action opens. The action is queued rather than
  // already performed precisely so it can run inside `trigger()`; a step that clicked first would
  // have opened the popup before the driver started listening for it. `takeWalletTrigger` consumes
  // it one-shot, so a stray second approval can never silently re-run the previous action.
  When('I approve the wallet popup', async ({ context }: WalletStepFixtures) => {
    const wallet = requireDriver(driver);
    const trigger = takeWalletTrigger(context);
    await wallet.confirmTransaction(context, trigger);
  });

  // "The popup closed" is never proof a transaction landed — this polls the chain for real.
  Then('the transaction is mined', async ({ context }: WalletStepFixtures) => {
    const txid = requireTransactionId(context);
    const resolvedRpcUrl = rpcUrl ?? STACKS_NETWORK_RPC_URLS[walletNetwork(context) ?? 'testnet4'];

    const status = await waitForTransactionMined(txid, {
      rpcUrl: resolvedRpcUrl,
      timeoutMs: minedTimeoutMs,
    });

    // `waitForTransactionMined` returns an abort status rather than throwing on one — a mined-but-
    // rejected transaction is a test failure, not a pass.
    assertMinedStatus(txid, status);
  });

  return bdd;
}
