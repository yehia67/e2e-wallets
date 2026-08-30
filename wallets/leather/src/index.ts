import type {
  BrowserContext,
  SupportedStacksNetwork,
  WalletAccount,
  WalletDriver,
} from '@wallets-e2e/core';
import { resolveExtensionId } from '@wallets-e2e/core';
import { wallet } from '../fixtures/wallet.js';

/**
 * WalletDriver adapter for the real Leather extension (AD-2). Only `importWallet` is implemented
 * here (Story 1.1) — `connectToDapp`/`confirmTransaction` are typed stubs for Stories 1.2/1.3,
 * fixing the interface shape now so those stories implement against an already-agreed contract.
 *
 * Onboarding flow below was verified by direct inspection of the real, source-built extension
 * (leather-io/extension) — not guessed at. Three things a guess would have gotten wrong (logged
 * in the story spec's Spec Change Log):
 *   1. Leather defaults to a 24-word seed entry screen; our fixture seed is 24 words, so the
 *      "Have a 12-word Secret Key?" toggle must NOT be clicked.
 *   2. The /set-password screen enforces a minimum password-strength meter — a weak password
 *      (e.g. "password1") leaves the Continue button permanently disabled ("Poor" strength).
 *   3. Leather's dashboard never renders the account address as page text. The only reliable,
 *      real signal is its own persisted `chrome.storage.local` state post-unlock, which — cross-
 *      checked independently via @stacks/wallet-sdk — surfaces the *mainnet*-form address, not
 *      the devnet/testnet form. This driver asserts against that mainnet form for that reason.
 */
export const leatherDriver: WalletDriver<SupportedStacksNetwork> = {
  async importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount> {
    // Leather doesn't reliably auto-open an onboarding tab the instant the context launches —
    // observed directly during inspection (present in some runs, absent in others depending on
    // timing). Fall back to navigating to the extension's own index page explicitly rather than
    // assuming one will already exist.
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)\//)?.[1];
    if (!extensionId) {
      throw new Error(`[wallets/leather] Could not resolve extension ID from service worker URL "${worker.url()}".`);
    }

    let page = context.pages().find((p) => p.url().startsWith('chrome-extension://'));
    if (!page) {
      page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/index.html`);
    }

    await page.waitForLoadState('domcontentloaded');

    // Landing screen ("get-started"): Create new wallet / Use existing key / Use Ledger.
    await page.getByRole('button', { name: /use existing key/i }).click();

    // Sign-in screen: one password-type <input name="1".."N"> per seed word. Defaults to 24-word
    // layout — never toggle word count, just fill however many inputs the phrase actually has.
    const words = seedPhrase.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      await page.locator(`input[name="${i + 1}"]`).fill(words[i]);
    }
    // Continue stays disabled until every word field is filled — bounded wait, not an indefinite
    // click-retry, so a malformed/incomplete seed phrase fails fast instead of hanging until the
    // whole test's outer timeout (observed directly: an unbounded click here consumed a full 120s
    // test timeout on an empty seed rather than failing in seconds).
    const signInContinueBtn = page.getByRole('button', { name: /^continue$/i });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="sign-in-btn"]') as HTMLButtonElement | null;
        return !!btn && !btn.disabled;
      },
      undefined,
      { timeout: 8_000 },
    );
    await signInContinueBtn.click();

    // Set-password screen: single <input name="password">. Continue stays disabled until the
    // strength meter clears "Poor" — the fixture password (AD-5) is chosen to satisfy this.
    await page.waitForURL(/#\/set-password/, { timeout: 10_000 });
    await page.locator('input[name="password"]').fill(wallet.password);
    const continueBtn = page.getByRole('button', { name: /^continue$/i });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="set-password-btn"]') as HTMLButtonElement | null;
        return !!btn && !btn.disabled;
      },
      undefined,
      { timeout: 10_000 },
    );
    await continueBtn.click();

    // Wallet unlocks straight into the dashboard at the root route ("#/").
    await page.waitForURL(/#\/$/, { timeout: 15_000 });
    await page.getByText(/^account 1$/i).waitFor({ state: 'visible', timeout: 10_000 });

    // Real verification signal: read the address back out of the extension's own persisted state
    // via its service worker, rather than trusting that the flow above "must have worked."
    const storage = (await worker.evaluate(() => chrome.storage.local.get(null))) as Record<string, unknown>;
    const json = JSON.stringify(storage);
    const found = json.includes(wallet.mainnetAddress);
    if (!found) {
      throw new Error(
        `[wallets/leather] Unlocked, but expected address ${wallet.mainnetAddress} was not found in Leather's persisted storage — import likely failed silently.`,
      );
    }

    return { address: wallet.mainnetAddress };
  },

  async switchNetwork(context: BrowserContext, network: SupportedStacksNetwork): Promise<void> {
    // Real discovery (Story 1.4): Leather defaults to mainnet regardless of what network the
    // dapp/RPC call names — a transfer request against an account Leather thinks is on mainnet
    // (0 balance there) crashes Leather's own fee-estimation step outright ("Error generating
    // unsigned stacks transaction"), rather than failing gracefully. The wallet's own active
    // network must be switched first. (A local Clarinet devnet network was tried first and
    // dropped — two independent, real Clarinet 3.23.1 bugs made it unusable; Leather's built-in
    // "Testnet4" preset, `api.testnet.hiro.so`, is used instead.)
    const page = context.pages().find((p) => p.url().startsWith('chrome-extension://') && p.url().includes('index.html'));
    if (!page) {
      throw new Error('[wallets/leather] switchNetwork: no open Leather dashboard page found — call importWallet first.');
    }

    // The header's settings menu trigger has no stable testid/aria-label (icon-only button) — it
    // is reliably the first `aria-haspopup="menu"` button in DOM order (a second, unrelated one
    // exists further down for "Collectibles").
    await page.locator('button[aria-haspopup="menu"]').first().click();
    await page.locator('[data-testid="settings-change-network"]').click();
    // Leather's own picker uses the network name as the row's testid — verified against the real
    // UI for `testnet4`, which is the only network this project's tests exercise.
    await page.locator(`[data-testid="${network}"]`).click();

    // Real signal: the dashboard's balance display updates once Leather has actually queried the
    // selected network — never trust "the menu closed" as proof the switch took effect.
    await page.getByText(new RegExp(`^${network}$`, 'i')).waitFor({ state: 'visible', timeout: 10_000 });
  },

  /** @deprecated Use `switchNetwork(context, 'testnet4')`. */
  async switchToTestnetNetwork(context: BrowserContext): Promise<void> {
    await leatherDriver.switchNetwork?.(context, 'testnet4');
  },

  async connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    // `trigger` is entirely the caller's job (Story 1.1 Design Notes / AD-2): it must perform
    // every dapp-side click needed to reach a real extension popup — e.g. clicking the dapp's own
    // "Connect Wallet" button AND, since @stacks/connect shows its own in-page multi-wallet picker
    // first (plain DOM, not shadow-root — verified by inspection), the picker's "Connect" button
    // for Leather specifically. Which wallet to pick in that generic picker is the caller's
    // knowledge, not this driver's — the picker isn't Leather's UI at all.
    const extensionId = await resolveExtensionId(context);
    const popupPromise = context.waitForEvent('page', { timeout: 10_000 });
    await trigger();
    const popup = await popupPromise;

    // Origin-verify per AD-3 before interacting — never trust "a page opened" alone.
    if (!popup.url().startsWith(`chrome-extension://${extensionId}/popup.html`)) {
      throw new Error(
        `[wallets/leather] connectToDapp: expected a Leather popup, got "${popup.url()}" — trigger() likely didn't reach Leather's approval popup.`,
      );
    }

    // Real approval screen, verified by inspection: "CONNECT APP" / account selector / Deny /
    // Confirm, with a stable data-testid on the approve button.
    const approveBtn = popup.locator('[data-testid="get-addresses-approve-button"]');
    await approveBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await approveBtn.click();

    // Success signal within this driver's own scope (it never sees the dapp page — the dapp's own
    // test asserts the connected address landed there, per AD-8's fuller intent): the popup must
    // close cleanly after Confirm, not hang or error. A Deny click, or the popup staying open,
    // both fail this wait rather than being mistaken for success.
    await popup.waitForEvent('close', { timeout: 10_000 });
  },

  async confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    // Same shape as connectToDapp: trigger performs every dapp-side action needed to reach the
    // real popup (e.g. clicking a "Sign Message" button that calls @stacks/connect's request()).
    const extensionId = await resolveExtensionId(context);
    const popupPromise = context.waitForEvent('page', { timeout: 10_000 });
    await trigger();
    const popup = await popupPromise;

    if (!popup.url().startsWith(`chrome-extension://${extensionId}/popup.html`)) {
      throw new Error(
        `[wallets/leather] confirmTransaction: expected a Leather popup, got "${popup.url()}" — trigger() likely didn't reach Leather's approval popup.`,
      );
    }

    // Real approval screen, verified by inspection: "SIGN MESSAGE" screen uses a "Sign" button;
    // "SEND TOKEN" (a real transfer) uses "Approve" instead — neither has a stable data-testid
    // (unlike get-addresses), so match either exact label.
    const confirmBtn = popup.getByRole('button', { name: /^(sign|approve)$/i });
    await confirmBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await confirmBtn.click();

    // Same driver-scope success signal as connectToDapp (AD-8): popup must close cleanly.
    await popup.waitForEvent('close', { timeout: 10_000 });
  },
};
