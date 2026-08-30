import { join } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createExtensionTest, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

type Fixtures = {
  unlockedContext: BrowserContext;
  connectedApp: { context: BrowserContext; appPage: Page };
  connectedAppOnTestnet: { context: BrowserContext; appPage: Page };
};

export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e',
  extensionName: 'Leather',
  buildCommand: 'bash wallets/leather/scripts/build-extension.sh',
  onMissingExtension: 'skip',
}).extend<Fixtures>({
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
    await leatherDriver.switchNetwork?.(unlockedContext, wallet.network);

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
