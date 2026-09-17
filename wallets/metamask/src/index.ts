import type { Page } from '@playwright/test';
import type { BrowserContext, EvmNetwork, WalletAccount, WalletDriver } from '@wallets-e2e/core';
import { EVM_NETWORKS, resolveExtensionId } from '@wallets-e2e/core';
import { APPROVAL_SELECTORS } from './selectors.js';
import { assertMetaMaskPopupUrl } from './utils.js';
import { hasAuthorizedDappAccount } from './session.js';
import { importWallet } from './onboarding.js';
import {
  clickConnectApprove,
  clickSignatureConfirm,
  clickTransactionConfirm,
  resolveApprovalPage,
  resolveMetaMaskApprovalPage,
  waitForApprovalToSettle,
  waitForMetaMaskLoad,
} from './approvals.js';
import { applyPendingNetworkToDapp, ensureNetwork } from './networks.js';

export {
  ensureMetamaskExtension,
  isMetamaskExtensionReady,
  metamaskExtensionPath,
  METAMASK_EXTENSION_PATH_ENV,
  METAMASK_PREPARE_COMMAND,
  METAMASK_VERSION,
} from './extension.js';
export { createMetamaskTest, type CreateMetamaskTestOptions } from './test.js';

export interface ApproveTokenPermissionOptions {
  spendLimit?: 'requested' | 'max' | number;
}

export interface MetaMaskDriver extends WalletDriver<EvmNetwork> {
  approveTokenPermission(
    context: BrowserContext,
    trigger: () => Promise<void>,
    options?: ApproveTokenPermissionOptions,
  ): Promise<void>;
  confirmSignature(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
  /**
   * Confirms an approval that is already pending, returning false when none appears.
   * Lets a caller drain however many popups an action queued without knowing the count.
   */
  confirmPendingTransaction(context: BrowserContext, timeoutMs?: number): Promise<boolean>;
  /**
   * Triggers an action and confirms every approval it raises. Returns the count, so a
   * caller can assert on it when the number of writes is part of what is being tested.
   */
  confirmTransactions(
    context: BrowserContext,
    trigger: () => Promise<void>,
    options?: {
      /** How many approvals the action raises. Waits properly for each; default 1. */
      expected?: number;
      drainTimeoutMs?: number;
    },
  ): Promise<number>;
}

export const metamaskDriver: MetaMaskDriver = {
  async importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount> {
    return importWallet(context, seedPhrase);
  },

  async switchNetwork(context: BrowserContext, network: EvmNetwork): Promise<void> {
    await ensureNetwork(context, network);
  },

  async switchToTestnetNetwork(context: BrowserContext): Promise<void> {
    await ensureNetwork(context, EVM_NETWORKS.sepolia);
  },

  async connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

    await applyPendingNetworkToDapp(context, extensionId);

    await trigger();

    const authorizationDeadline = Date.now() + 3_000;
    while (Date.now() < authorizationDeadline) {
      if (await hasAuthorizedDappAccount(context, extensionId)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const popup = await resolveMetaMaskApprovalPage(context, extensionId);

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'connectToDapp');
    await popup.waitForLoadState('domcontentloaded');

    await clickConnectApprove(popup);
    await waitForApprovalToSettle(popup);
  },

  async confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

    await trigger();

    const popup = await resolveApprovalPage(
      context,
      extensionId,
      APPROVAL_SELECTORS.any,
      'confirmTransaction',
    );

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'confirmTransaction');
    await popup.waitForLoadState('domcontentloaded');
    await popup
      .locator(APPROVAL_SELECTORS.confirmationReady)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    for (let i = 0; i < 3; i++) {
      const nextNav = popup.locator('[data-testid="confirm-nav__next-confirmation"]');
      if (await nextNav.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await nextNav.click();
        await popup.waitForTimeout(300);
        continue;
      }
      break;
    }

    await clickTransactionConfirm(popup);
    const confirmBtn = popup.locator('[data-testid="confirm-btn"]');
    if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await waitForApprovalToSettle(popup);
  },

  /**
   * Triggers an action and confirms every approval it raises, however many that is.
   *
   * The common case for a dapp that provisions something before using it: one click, two
   * or more writes. Whether the wallet batches them into a single confirmation with a
   * "next" navigator or raises them one at a time is MetaMask's decision and varies by
   * account type, so a caller cannot know the count in advance — and an unconfirmed
   * second approval simply stalls the test until it times out.
   *
   * @returns how many approvals were confirmed, always at least one.
   */
  async confirmTransactions(
    context: BrowserContext,
    trigger: () => Promise<void>,
    options: { expected?: number; drainTimeoutMs?: number } = {},
  ): Promise<number> {
    await metamaskDriver.confirmTransaction(context, trigger);
    let confirmed = 1;

    // `expected` matters when writes are chained rather than queued together: a dapp that
    // provisions a contract and then uses it waits for the first receipt before asking
    // for the second signature, so the next approval can be many seconds away. Draining
    // on a short idle timeout gives up in that gap and leaves the second write
    // unconfirmed — the test then waits for a transaction nobody authorised. Knowing how
    // many to expect lets each one be waited for properly, while still returning
    // immediately once they are all in.
    const expected = options.expected ?? 1;
    const perApproval = options.drainTimeoutMs ?? (options.expected ? 90_000 : 12_000);

    while (confirmed < expected) {
      if (!(await metamaskDriver.confirmPendingTransaction(context, perApproval))) break;
      confirmed += 1;
    }

    // Anything beyond `expected` is queued alongside, so a short window is right for it.
    while (await metamaskDriver.confirmPendingTransaction(context, 5_000)) confirmed += 1;

    return confirmed;
  },

  /**
   * Confirms one approval that is *already* pending, without triggering it.
   *
   * A dapp action can queue more than one write — provisioning a contract before using
   * it, say. Whether the wallet shows those as one confirmation with a "next" navigator
   * or as separate popups is MetaMask's decision and varies by account type: a 7702
   * delegated account batches some flows and not others. `confirmTransaction` handles
   * exactly one popup, so the rest would sit unconfirmed until the test times out.
   *
   * Returns false when no approval appears within `timeoutMs`, so a caller can drain
   * "however many are pending" without knowing the count in advance.
   */
  async confirmPendingTransaction(
    context: BrowserContext,
    timeoutMs = 15_000,
  ): Promise<boolean> {
    const extensionId = await resolveExtensionId(context);
    const deadline = Date.now() + timeoutMs;
    const ready = APPROVAL_SELECTORS.confirmationReady;

    // A queued approval frequently has no window of its own: MetaMask drops the popup
    // once one approval resolves and leaves the next sitting in its queue. Scanning open
    // pages alone therefore misses it — notification.html has to be opened to surface it,
    // the same way `resolveApprovalPage` does for the first approval.
    let scratch: Page | undefined;
    let popup: Page | undefined;

    // Watch, mostly. MetaMask raises its own approval window for a queued request, and
    // forcing `notification.html` open is a heavy, disruptive act: done on every poll it
    // is hundreds of navigations of the wallet's approval surface during a run, which
    // derails the queue it is meant to be reading. So poll the pages that already exist,
    // and only force one open after the wallet has had a fair chance on its own.
    const FORCE_OPEN_AFTER_MS = 8_000;
    const startedAt = Date.now();
    let forcedOpen = false;

    while (Date.now() < deadline && !popup) {
      for (const page of context.pages()) {
        if (page.isClosed()) continue;
        if (!page.url().startsWith(`chrome-extension://${extensionId}/`)) continue;
        if (await page.locator(ready).first().isVisible().catch(() => false)) {
          // Clicking a half-hydrated surface silently does nothing.
          await waitForMetaMaskLoad(page).catch(() => {});
          popup = page;
          break;
        }
      }
      if (popup) break;

      if (!forcedOpen && Date.now() - startedAt > FORCE_OPEN_AFTER_MS) {
        forcedOpen = true;
        scratch = await context.newPage();
        await scratch.goto(`chrome-extension://${extensionId}/notification.html`).catch(() => {});
        await scratch.waitForLoadState('domcontentloaded').catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    if (!popup) {
      // Nothing pending. Close the scratch tab so it never becomes the focused surface.
      if (scratch && !scratch.isClosed()) await scratch.close().catch(() => {});
      return false;
    }

    // The approval's own id. Used below to tell "this one was actioned" from "the same
    // one is still sitting there", which is the difference between draining a queue and
    // clicking the same button forever.
    const approvalId = (id: string) => id.split('#').pop() ?? id;
    const before = approvalId(popup.url());

    await clickTransactionConfirm(popup);
    const confirmBtn = popup.locator('[data-testid="confirm-btn"]');
    if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await waitForApprovalToSettle(popup);

    // `waitForApprovalToSettle` logs rather than throws when an approval refuses to
    // clear, so without this the caller sees a success and asks for the next one —
    // finding the same approval again, forever. Report failure instead and let the
    // caller stop; a stuck approval is a real problem worth surfacing, not retrying.
    let settled = true;
    if (!popup.isClosed() && approvalId(popup.url()) === before) {
      const stillThere = await popup
        .locator(APPROVAL_SELECTORS.confirmationReady)
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false);
      if (stillThere) settled = false;
    }

    // Always close a tab this method opened, including the one that served the
    // approval. Left open it sits on an empty notification page for the rest of the
    // run — Playwright keeps recording it, and that idle page then takes up a whole
    // segment of the composed video.
    if (scratch && !scratch.isClosed()) await scratch.close().catch(() => {});

    // Leave the app in front, so the recording returns to it rather than to whatever
    // wallet surface happened to be last.
    const app = context
      .pages()
      .reverse()
      .find((page) => !page.isClosed() && /^https?:\/\//i.test(page.url()));
    if (app) await app.bringToFront().catch(() => {});

    return settled;
  },

  async approveTokenPermission(
    context: BrowserContext,
    trigger: () => Promise<void>,
    options: ApproveTokenPermissionOptions = {},
  ): Promise<void> {
    const extensionId = await resolveExtensionId(context);
    await trigger();
    const popup = await resolveApprovalPage(
      context,
      extensionId,
      `${APPROVAL_SELECTORS.permission}, ${APPROVAL_SELECTORS.any}`,
      'approveTokenPermission',
    );
    assertMetaMaskPopupUrl(popup.url(), extensionId, 'approveTokenPermission');
    await popup.waitForLoadState('domcontentloaded');

    if (options.spendLimit === 'max') {
      await popup.locator('[data-testid="custom-spending-cap-max-button"]').click();
    } else if (typeof options.spendLimit === 'number') {
      if (!Number.isFinite(options.spendLimit) || options.spendLimit < 0) {
        throw new Error('[wallets/metamask] approveTokenPermission: spendLimit must be non-negative.');
      }
      await popup
        .locator('[data-testid="custom-spending-cap-input"]')
        .fill(String(options.spendLimit));
    }

    const next = popup.locator('[data-testid="page-container-footer-next"]');
    if (await next.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await next.click();
      await popup.waitForTimeout(300);
    }
    await clickTransactionConfirm(popup);
    await waitForApprovalToSettle(popup);
  },

  async confirmSignature(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

    await trigger();

    const popup = await resolveApprovalPage(
      context,
      extensionId,
      `${APPROVAL_SELECTORS.signature}, ${APPROVAL_SELECTORS.any}`,
      'confirmSignature',
    );

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'confirmSignature');
    await popup.waitForLoadState('domcontentloaded');
    await popup
      .locator(APPROVAL_SELECTORS.signatureReady)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    await clickSignatureConfirm(popup);
    await waitForApprovalToSettle(popup);
  },
};
