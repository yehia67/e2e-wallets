import type { BrowserContext, Page, WalletAccount } from '@wallets-e2e/core';
import { HOME_SELECTOR } from './selectors.js';
import { bodySnippet } from './utils.js';
import { openOnboardingPage, verifyUnlockedAddress } from './session.js';
import { wallet } from '../fixtures/wallet.js';

async function skipPasskeySetupIfShown(page: Page): Promise<void> {
  const maybeLater = page.locator('[data-testid="passkey-maybe-later-button"]');
  if (await maybeLater.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await maybeLater.click();
    await page.locator('[data-testid="parent-selector-onboarding-metrics"]').waitFor({ state: 'visible', timeout: 15_000 });
  }
}

async function completeMetricsIfShown(page: Page): Promise<void> {
  const legacyOptOut = page.locator('#metametrics-opt-in');
  if (await legacyOptOut.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await legacyOptOut.click();
    await page.locator('[data-testid="metametrics-i-agree"]').click();
    return;
  }

  const metricsPage = page.locator('[data-testid="parent-selector-onboarding-metrics"]');
  if (await metricsPage.isVisible({ timeout: 8_000 }).catch(() => false)) {
    const unchecked = page.locator('[data-testid="metametrics-checkbox"][data-checked="false"]');
    if (!(await unchecked.isVisible({ timeout: 500 }).catch(() => false))) {
      await page.locator('[data-testid="metametrics-checkbox"]').click();
    }
    await page.locator('[data-testid="metametrics-i-agree"]').click();
    await page.locator('[data-testid="parent-selector-onboarding-complete"]').waitFor({ state: 'visible', timeout: 15_000 });
  }
}

export async function finishImportOnboarding(page: Page, extensionId: string): Promise<void> {
  await skipPasskeySetupIfShown(page);
  await completeMetricsIfShown(page);

  const downloadContinue = page.locator('[data-testid="download-app-continue"]');
  if (await downloadContinue.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await downloadContinue.click();
  }

  const completeButton = page.locator('[data-testid="onboarding-complete-done"]');
  if (await completeButton.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await completeButton.click();
    await page.waitForTimeout(1_000);
  }

  await page.goto(`chrome-extension://${extensionId}/home.html`);
  await page
    .locator(HOME_SELECTOR)
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 })
    .catch(async () => {
      throw new Error(
        `[wallets/metamask] Import completed but the dashboard did not load at ${page.url()}. ` +
          `UI:\n${await bodySnippet(page, 1_000)}`,
      );
    });

  const shieldSkip = page.locator('[data-testid="shield-entry-modal-close-button"]');
  if (await shieldSkip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await shieldSkip.click();
  }
}

export async function fillImportSrp(page: Page, seedPhrase: string): Promise<void> {
  const words = seedPhrase.trim().split(/\s+/).filter(Boolean);
  if (words.length !== 12 && words.length !== 24) {
    throw new Error(
      `[wallets/metamask] importWallet: expected 12 or 24 seed words, got ${words.length}. ` +
        `Ensure WALLETS_E2E_SEED_PHRASE is a single quoted line in wallets/metamask/.env.local.`,
    );
  }

  const note = page.locator('[data-testid="srp-input-import__srp-note"]');
  await note.click();
  await note.fill(words[0]);
  if (words.length > 1) await note.press('Space');

  for (let i = 1; i < words.length; i++) {
    const wordInput = page.locator(`[data-testid="import-srp__srp-word-${i}"]`);
    await wordInput.waitFor({ state: 'visible', timeout: 8_000 });
    await wordInput.fill(words[i]);
    if (i < words.length - 1) await wordInput.press('Space');
  }
}

export async function importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount> {
  const trimmed = seedPhrase.trim();
  if (!trimmed) {
    throw new Error('[wallets/metamask] importWallet: seed phrase is empty — refusing to hang on a disabled confirm button.');
  }

  const { page, extensionId } = await openOnboardingPage(context);

  await page.locator('[data-testid="onboarding-import-wallet"]').click({ timeout: 15_000 });
  await page.locator('[data-testid="onboarding-import-with-srp-button"]').click();

  await page.locator('[data-testid="srp-input-import__srp-note"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await fillImportSrp(page, trimmed);
  const confirmSrp = page.locator('[data-testid="import-srp-confirm"]');

  await confirmSrp.waitFor({ state: 'visible', timeout: 8_000 });
  const confirmDeadline = Date.now() + 15_000;
  while (Date.now() < confirmDeadline && !(await confirmSrp.isEnabled())) {
    await page.waitForTimeout(200);
  }
  if (!(await confirmSrp.isEnabled())) {
    throw new Error('[wallets/metamask] importWallet: SRP confirm stayed disabled — seed phrase may be invalid or incomplete.');
  }
  await confirmSrp.click();

  await page.locator('[data-testid="create-password-new-input"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await page.locator('[data-testid="create-password-new-input"]').fill(wallet.password);
  await page.locator('[data-testid="create-password-confirm-input"]').fill(wallet.password);
  await page.locator('[data-testid="create-password-terms"]').click();
  const submitPwd = page.locator('[data-testid="create-password-submit"]');
  const pwdDeadline = Date.now() + 10_000;
  while (Date.now() < pwdDeadline && !(await submitPwd.isEnabled())) {
    await page.waitForTimeout(200);
  }
  await submitPwd.click();

  await page
    .locator(
      '[data-testid="parent-selector-setup-passkey"], ' +
        '[data-testid="parent-selector-onboarding-metrics"], ' +
        '#metametrics-opt-in, [data-testid="onboarding-complete-done"]',
    )
    .first()
    .waitFor({
    state: 'visible',
    timeout: 20_000,
  });

  await finishImportOnboarding(page, extensionId);
  await verifyUnlockedAddress(context, page, extensionId, wallet.address);

  return { address: wallet.address };
}
