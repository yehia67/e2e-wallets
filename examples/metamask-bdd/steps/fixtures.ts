import { join } from 'node:path';
import { expect } from '@playwright/test';
import { createExtensionTest } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test as bddTest } from 'playwright-bdd';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/metamask/dist');

export const test = createExtensionTest({
  base: bddTest,
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-metamask-bdd',
  extensionName: 'MetaMask',
  buildCommand: 'pnpm build:metamask',
});

export const { Given, When, Then } = createWalletSteps({
  test,
  driver: metamaskDriver,
  seedPhrase: wallet.seedPhrase,
  walletName: 'MetaMask',
  connect: async (page) => {
    await page.getByTestId('connect-wallet').click();
  },
});

export { expect };
