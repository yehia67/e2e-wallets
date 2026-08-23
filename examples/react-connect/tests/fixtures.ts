import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

type Fixtures = {
  /** A real, launched Leather context — video-recorded, auto-closed, skips if the extension isn't built. */
  extensionContext: BrowserContext;
  /** Same context, already unlocked via the fixture wallet (Story 1.1's proven flow). */
  unlockedContext: BrowserContext;
  /** Already unlocked AND connected to this app — the shared setup every sign test needs. */
  connectedApp: { context: BrowserContext; appPage: Page };
  /**
   * Like `connectedApp`, but also switched to Leather's testnet network first — required before
   * any chain-aware operation (Story 1.4 discovery: Leather defaults to mainnet, which crashes
   * its own fee-estimation step outright for an account with no mainnet balance). What the
   * transfer and contract-call tests need.
   */
  connectedAppOnTestnet: { context: BrowserContext; appPage: Page };
};

/**
 * Playwright best practice: push setup/teardown into fixtures rather than repeating
 * `try { ... } finally { context.close() }` and the same `test.skip` guard in every test.
 * Each fixture layers on the one before it, matching how much setup a given test actually needs.
 */
export const test = base.extend<Fixtures>({
  extensionContext: async ({}, use, testInfo) => {
    testInfo.skip(
      !existsSync(join(EXTENSION_PATH, 'manifest.json')),
      'Leather is not built yet — run: bash wallets/leather/scripts/build-extension.sh',
    );

    const context = await launchContext({
      extensionPath: EXTENSION_PATH,
      userDataDir: mkdtempSync(join(tmpdir(), `wallets-e2e-${testInfo.testId}-`)),
      recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
    });
    await use(context);
    await context.close();
  },

  unlockedContext: async ({ extensionContext }, use) => {
    await leatherDriver.importWallet(extensionContext, wallet.seedPhrase);
    await use(extensionContext);
  },

  connectedApp: async ({ unlockedContext }, use) => {
    const appPage = await unlockedContext.newPage();
    await appPage.goto('/');
    await leatherDriver.connectToDapp(unlockedContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
      await selectWalletInStacksConnectModal(appPage, 'Leather');
    });
    await expect(appPage.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });
    await use({ context: unlockedContext, appPage });
  },

  connectedAppOnTestnet: async ({ unlockedContext }, use) => {
    await leatherDriver.switchToTestnetNetwork?.(unlockedContext);

    const appPage = await unlockedContext.newPage();
    await appPage.goto('/');
    await leatherDriver.connectToDapp(unlockedContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
      await selectWalletInStacksConnectModal(appPage, 'Leather');
    });
    await expect(appPage.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });
    await use({ context: unlockedContext, appPage });
  },
});

export { expect };
