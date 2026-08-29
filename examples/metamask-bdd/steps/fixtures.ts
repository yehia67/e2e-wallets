import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { launchContext } from '@wallets-e2e/core';
import { createWalletSteps, queueWalletTrigger } from '@wallets-e2e/core/bdd';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test as base } from 'playwright-bdd';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/metamask/dist');
const DEPLOYED_PATH = join(import.meta.dirname, '../../metamask-spike/deployed.sepolia.json');

const REQUIRE_EXTENSION = process.env.WALLETS_E2E_REQUIRE_EXTENSION === '1';

export const test = base.extend({
  context: async ({}, use, testInfo) => {
    const built = existsSync(join(EXTENSION_PATH, 'manifest.json'));
    if (!built && REQUIRE_EXTENSION) {
      throw new Error(
        `MetaMask is not built at ${EXTENSION_PATH}. Run: pnpm build:metamask`,
      );
    }
    testInfo.skip(!built, 'MetaMask is not built yet — run: pnpm build:metamask');

    const userDataDir = mkdtempSync(join(tmpdir(), `wallets-e2e-metamask-bdd-${testInfo.testId}-`));
    try {
      const context = await launchContext({
        extensionPath: EXTENSION_PATH,
        userDataDir,
        recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
      });
      try {
        await use(context);
      } finally {
        await context.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  },

  page: async ({ context }: { context: BrowserContext }, use: (page: Page) => Promise<void>) => {
    const page = await context.newPage();
    await use(page);
  },
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
