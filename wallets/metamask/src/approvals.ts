import type { BrowserContext, Page } from '@wallets-e2e/core';
import { debugDescribePage, debugLog } from './debug.js';
import {
  APPROVAL_SELECTORS,
  CRITICAL_ERROR,
  CRITICAL_ERROR_RESTART_BUTTON,
  ERROR_PAGE,
  LOADING_INDICATORS,
} from './selectors.js';
import { bodySnippet } from './utils.js';

const APPROVAL_SETTLE_MS = 300;

const LOADING_INDICATOR_TIMEOUT_MS = 10_000;

async function fixCriticalError(page: Page, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (page.isClosed()) return;
    const crashed =
      (await page.locator(CRITICAL_ERROR).count().catch(() => 0)) > 0 ||
      (await page.locator(ERROR_PAGE).count().catch(() => 0)) > 0;
    if (!crashed) return;

    debugLog(`fixCriticalError: MetaMask crashed, reloading (attempt ${attempt + 1})`);
    const restart = page.locator(CRITICAL_ERROR_RESTART_BUTTON);
    if (await restart.isVisible({ timeout: 500 }).catch(() => false)) {
      await restart.click().catch(() => {});
    } else {
      await page.reload().catch(() => {});
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(500 * (attempt + 1));
  }
}

async function waitForMetaMaskLoad(page: Page): Promise<Page> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await Promise.all(
    LOADING_INDICATORS.map((selector) =>
      page
        .waitForSelector(selector, { state: 'hidden', timeout: LOADING_INDICATOR_TIMEOUT_MS })
        .catch(() => null),
    ),
  );
  await page.waitForTimeout(APPROVAL_SETTLE_MS).catch(() => {});
  await fixCriticalError(page);
  return page;
}

export async function resolveApprovalPage(
  context: BrowserContext,
  extensionId: string,
  selector: string,
  method: string,
): Promise<Page> {
  const startedAt = Date.now();

  let opened: Page | undefined;
  const maxAttempts = 80;
  for (let i = 0; i < maxAttempts; i++) {
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      if (!page.url().startsWith(`chrome-extension://${extensionId}/`)) continue;
      if (await page.locator(selector).first().isVisible().catch(() => false)) {
        await waitForMetaMaskLoad(page);

        if (
          !(await page
            .locator(selector)
            .first()
            .isVisible({ timeout: 2_000 })
            .catch(() => false))
        ) {
          debugLog(`${method}: candidate stopped matching after loading — still looking`);
          continue;
        }
        debugLog(`${method}: resolved a surface after ${Date.now() - startedAt}ms`);
        await debugDescribePage(page, `${method}: resolved surface`);
        return page;
      }
    }

    if (i === 0 || (i > 0 && i % 16 === 0)) {
      if (!opened || opened.isClosed()) {
        opened = await context.newPage();
      }
      debugLog(`${method}: opening notification.html itself (attempt ${i})`);
      await opened
        .goto(`chrome-extension://${extensionId}/notification.html`)
        .catch(() => {});
      await opened.waitForLoadState('domcontentloaded').catch(() => {});
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const openPages = context
    .pages()
    .filter((p) => !p.isClosed())
    .map((p) => p.url())
    .join('\n  ');
  throw new Error(
    `[wallets/metamask] ${method}: no approval UI appeared after trigger(). ` +
      `Looked for ${selector}. Open pages:\n  ${openPages}`,
  );
}

export async function resolveMetaMaskApprovalPage(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  return resolveApprovalPage(context, extensionId, APPROVAL_SELECTORS.any, 'connectToDapp');
}



export async function clickSignatureConfirm(popup: Page): Promise<void> {
  const legacyScroll = popup.locator('[data-testid="signature-request-scroll-button"]');
  const legacySign = popup.locator('[data-testid="page-container-footer-next"]');
  if (await legacySign.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !(await legacySign.isEnabled().catch(() => false))) {
      if (await legacyScroll.isVisible({ timeout: 500 }).catch(() => false)) {
        await legacyScroll.click();
      } else {
        await popup.waitForTimeout(250);
      }
    }
    if (!(await legacySign.isEnabled().catch(() => false))) {
      throw new Error(
        `[wallets/metamask] confirmSignature: Sign stayed disabled. UI:\n${await bodySnippet(popup)}`,
      );
    }
    await legacySign.click();
    return;
  }

  const nextNav = popup.locator('[data-testid="confirm-nav__next-confirmation"]');
  if (await nextNav.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await nextNav.click();
    await popup.waitForTimeout(300);
  }
  await clickTransactionConfirm(popup);
}

export async function clickConnectApprove(popup: Page): Promise<void> {
  const startedAt = Date.now();
  await debugDescribePage(popup, 'clickConnectApprove: on entry');
  const confirmBtn = popup.locator('[data-testid="confirm-btn"]');
  const legacyFooterButton = popup.locator('[data-testid="page-container-footer-next"]');

  await confirmBtn
    .or(legacyFooterButton)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {});

  if (await confirmBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    debugLog(`clickConnectApprove: confirm-btn after ${Date.now() - startedAt}ms`);
    await confirmBtn.click({ timeout: 10_000 });
    return;
  }
  debugLog(`clickConnectApprove: no confirm-btn after ${Date.now() - startedAt}ms — legacy footer path`);

  const legacyFooter = popup.locator('[data-testid="page-container-footer-next"]');
  let clicks = 0;
  for (let step = 0; step < 2; step++) {
    if (popup.isClosed()) return;
    if (await legacyFooter.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await legacyFooter.click({ timeout: 10_000 });
      clicks += 1;
      await popup.waitForTimeout(300).catch(() => {});
      continue;
    }
    const byLabel = popup.getByRole('button', { name: /^(connect|approve|next)$/i }).last();
    if (await byLabel.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await byLabel.click({ timeout: 10_000 });
      clicks += 1;
      await popup.waitForTimeout(300).catch(() => {});
      continue;
    }
    if (step > 0) break;
  }

  if (clicks > 0) return;

  throw new Error(
    `[wallets/metamask] connectToDapp: reached the approval page but found no Connect button ` +
      `([data-testid="confirm-btn"] or a "Connect" button). Page: ${popup.url()}\n` +
      `UI:\n${await bodySnippet(popup)}`,
  );
}

async function settleConfirmAlertModal(popup: Page): Promise<boolean> {
  const submit = popup.locator('[data-testid="confirm-alert-modal-submit-button"]');
  if (!(await submit.isVisible({ timeout: 1_000 }).catch(() => false))) return false;

  debugLog('settleConfirmAlertModal: danger-alert modal opened instead of submitting');
  const acknowledge = popup.locator('[data-testid="alert-modal-acknowledge-checkbox"]');
  if (await acknowledge.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await acknowledge.check().catch(() => {});
  }
  await submit.click({ timeout: 10_000 });
  return true;
}

async function scrollConfirmationToBottom(popup: Page): Promise<boolean> {
  const scrollDown = popup.locator('[data-testid="scroll-to-bottom"]');
  if (!(await scrollDown.isVisible({ timeout: 500 }).catch(() => false))) return false;
  debugLog('scrollConfirmationToBottom: clicking the scroll-to-bottom affordance');
  await scrollDown.click({ timeout: 5_000 }).catch(() => {});
  await popup.waitForTimeout(200).catch(() => {});
  return true;
}

export async function waitForApprovalToSettle(popup: Page, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();

  const requiredConsecutiveClearPolls = 3;
  let clearPolls = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (popup.isClosed()) {
      debugLog(`waitForApprovalToSettle: page closed after ${Date.now() - startedAt}ms`);
      return;
    }
    const stillShowing = await popup
      .locator(APPROVAL_SELECTORS.any)
      .first()
      .isVisible()
      .catch(() => false);

    clearPolls = stillShowing ? 0 : clearPolls + 1;
    if (clearPolls >= requiredConsecutiveClearPolls) {
      debugLog(`waitForApprovalToSettle: approval cleared after ${Date.now() - startedAt}ms`);
      return;
    }
    await popup.waitForTimeout(200).catch(() => {});
  }
  debugLog(`waitForApprovalToSettle: still showing an approval after ${timeoutMs}ms`);
}

export async function clickTransactionConfirm(popup: Page): Promise<void> {
  const redesignConfirm = popup.locator('[data-testid="confirm-footer-button"]');
  const legacyConfirm = popup.locator('[data-testid="confirmation-submit-button"]');
  const footerNext = popup.locator('[data-testid="page-container-footer-next"]');
  const confirm = redesignConfirm.or(legacyConfirm).or(footerNext).first();

  const startedAt = Date.now();
  await debugDescribePage(popup, 'clickTransactionConfirm: before waiting for a confirm button');
  await confirm.waitFor({ state: 'visible', timeout: 30_000 });
  debugLog(`clickTransactionConfirm: confirm button visible after ${Date.now() - startedAt}ms`);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await confirm.isEnabled().catch(() => false)) {
      debugLog(`clickTransactionConfirm: clicking after ${Date.now() - startedAt}ms`);
      await confirm.click({ timeout: 10_000 });
      await settleConfirmAlertModal(popup);
      await debugDescribePage(popup, 'clickTransactionConfirm: after click');
      return;
    }

    if (await scrollConfirmationToBottom(popup)) continue;
    const text = (await popup.locator('body').innerText().catch(() => '')).toLowerCase();
    if (
      text.includes('unable to connect') ||
      text.includes('unauthorized') ||
      text.includes('infura') ||
      text.includes('transaction failed') ||
      text.includes('alert')
    ) {
      throw new Error(
        `[wallets/metamask] confirmTransaction blocked (likely bad RPC). UI:\n${text.slice(0, 400)}`,
      );
    }
    await popup.waitForTimeout(400);
  }
  throw new Error(
    `[wallets/metamask] Confirm stayed disabled (gas/RPC). UI:\n${(await popup.locator('body').innerText().catch(() => '')).slice(0, 400)}`,
  );
}
