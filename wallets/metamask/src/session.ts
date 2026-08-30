import type { BrowserContext, Page } from '@wallets-e2e/core';
import { resolveExtensionId } from '@wallets-e2e/core';
import { HOME_SELECTOR } from './selectors.js';

export async function openOnboardingPage(context: BrowserContext): Promise<{ page: Page; extensionId: string }> {
  const extensionId = await resolveExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/home.html`);
  await page.waitForLoadState('domcontentloaded');
  return { page, extensionId };
}

export async function getUnlockedHomePage(context: BrowserContext): Promise<{ page: Page; extensionId: string }> {
  const extensionId = await resolveExtensionId(context);
  let page = context.pages().find(
    (p) =>
      !p.isClosed() &&
      p.url().startsWith(`chrome-extension://${extensionId}/`) &&
      p.url().includes('home.html'),
  );
  if (!page) {
    page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/home.html`);
  } else if (!(await page.locator(HOME_SELECTOR).first().isVisible({ timeout: 3_000 }).catch(() => false))) {
    await page.goto(`chrome-extension://${extensionId}/home.html`);
  }
  await page.locator(HOME_SELECTOR).first().waitFor({ state: 'visible', timeout: 45_000 });
  return { page, extensionId };
}

export async function hasAuthorizedDappAccount(
  context: BrowserContext,
  extensionId: string,
): Promise<boolean> {
  for (const page of [...context.pages()].reverse()) {
    if (
      page.isClosed() ||
      !/^https?:\/\//.test(page.url()) ||
      page.url().includes(`chrome-extension://${extensionId}/`)
    ) {
      continue;
    }
    const accounts = await page
      .evaluate(async () => {
        const provider = (window as unknown as {
          ethereum?: { request(value: unknown): Promise<unknown> };
        }).ethereum;
        if (!provider) return [];
        return provider.request({ method: 'eth_accounts' });
      })
      .catch(() => []);
    if (Array.isArray(accounts) && accounts.length > 0) return true;
  }
  return false;
}

export async function verifyUnlockedAddress(
  context: BrowserContext,
  page: Page,
  extensionId: string,
  expectedAddress: string,
): Promise<void> {
  if (!(await page.locator(HOME_SELECTOR).first().isVisible().catch(() => false))) {
    await page.goto(`chrome-extension://${extensionId}/home.html`);
    await page.locator(HOME_SELECTOR).first().waitFor({ state: 'visible', timeout: 30_000 });
  }
  const unlockedDashboardVisible = await page.locator(HOME_SELECTOR).first().isVisible();

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });

  try {
    const storage = (await worker.evaluate(() => chrome.storage.local.get(null))) as Record<string, unknown>;
    if (JSON.stringify(storage).toLowerCase().includes(expectedAddress.toLowerCase())) return;
  } catch {
  }

  const accountMenu = page.locator('[data-testid="account-options-menu-button"]');
  if (await accountMenu.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await accountMenu.click();
    const details = page.locator('[data-testid="account-list-menu-details"]');
    if (await details.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await details.click();
      const address = page.locator('[data-testid="address-copy-button-text"]').last();
      if (await address.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const shownAddress = (await address.innerText()).replace(/\s+/g, '').toLowerCase();
        const close = page.locator(
          '.mm-modal-content .mm-modal-header button.mm-button-icon.mm-button-icon--size-sm',
        );
        await close.click().catch(() => {});
        if (shownAddress === expectedAddress.toLowerCase()) return;
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  const normalized = expectedAddress.toLowerCase();
  if (bodyText.includes(normalized)) return;

  const prefix = normalized.slice(0, 7);
  const suffix = normalized.slice(-5);
  if (bodyText.includes(prefix) && bodyText.includes(suffix)) return;

  if (unlockedDashboardVisible) {
    return;
  }

  throw new Error(
    `[wallets/metamask] Unlocked, but expected address ${expectedAddress} was not found in MetaMask UI or storage — import likely failed silently.`,
  );
}
