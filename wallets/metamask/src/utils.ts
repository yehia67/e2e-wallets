import type { Page } from '@wallets-e2e/core';
import { HOME_SELECTOR } from './selectors.js';

export function assertMetaMaskPopupUrl(popupUrl: string, extensionId: string, method: string): void {
  const prefix = `chrome-extension://${extensionId}/`;
  if (!popupUrl.startsWith(prefix)) {
    throw new Error(
      `[wallets/metamask] ${method}: expected a MetaMask extension popup, got "${popupUrl}" — trigger() likely didn't reach MetaMask's approval popup.`,
    );
  }
  const allowed =
    popupUrl.includes('popup.html') ||
    popupUrl.includes('notification.html') ||
    popupUrl.includes('/connect/') ||
    popupUrl.includes('/confirmation');
  if (!allowed) {
    throw new Error(
      `[wallets/metamask] ${method}: expected popup/notification/connect/confirmation URL, got "${popupUrl}".`,
    );
  }
}

export function rpcNickname(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).hostname.replace(/^www\./, '').slice(0, 28);
  } catch {
    return 'Custom RPC';
  }
}

export async function bodySnippet(page: Page, n = 500): Promise<string> {
  return (await page.locator('body').innerText().catch(() => '')).slice(0, n);
}

export async function goHome(page: Page, extensionId: string): Promise<void> {
  if (await page.locator(HOME_SELECTOR).first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    return;
  }
  await page.goto(`chrome-extension://${extensionId}/home.html`);
  await page.locator(HOME_SELECTOR).first().waitFor({ state: 'visible', timeout: 45_000 });
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formInput(page: Page, inputTestId: string, wrapperTestId: string) {
  return page
    .locator(
      `input[data-testid="${inputTestId}"], ` +
        `input[data-testid="${wrapperTestId}"], ` +
        `[data-testid="${wrapperTestId}"] input`,
    )
    .first();
}
