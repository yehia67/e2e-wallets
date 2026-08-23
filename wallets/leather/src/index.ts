import type { BrowserContext, WalletAccount, WalletDriver } from '@stacks-wallet/core';
import { devnetWallet } from '../fixtures/devnet-wallet.js';

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
export const leatherDriver: WalletDriver = {
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
    await page.locator('input[name="password"]').fill(devnetWallet.password);
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
    const found = json.includes(devnetWallet.mainnetAddress);
    if (!found) {
      throw new Error(
        `[wallets/leather] Unlocked, but expected address ${devnetWallet.mainnetAddress} was not found in Leather's persisted storage — import likely failed silently.`,
      );
    }

    return { address: devnetWallet.mainnetAddress };
  },

  async connectToDapp(): Promise<void> {
    throw new Error('[wallets/leather] connectToDapp not implemented — Story 1.2');
  },

  async confirmTransaction(): Promise<void> {
    throw new Error('[wallets/leather] confirmTransaction not implemented — Story 1.3');
  },
};
