import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { launchContext } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
// `test` must come from playwright-bdd, not @playwright/test: createBdd() asserts the custom test
// it is handed already carries playwright-bdd's own fixtures, and exits with a message rather than
// a type error if it doesn't.
import { test as base } from 'playwright-bdd';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

/**
 * The two built-in fixtures are *overridden*, not added alongside: `@wallets-e2e/core/bdd`'s steps
 * read the stock `context` and `page`, which keeps them wallet- and project-agnostic. Everything
 * extension-specific — where the unpacked build lives, the persistent profile, the video dir —
 * stays here, in the consuming project, exactly as `examples/react-connect/tests/fixtures.ts:33-51`
 * already has it.
 */
export const test = base.extend({
  context: async ({}, use, testInfo) => {
    if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`Leather is not built at ${EXTENSION_PATH}. Build it first: pnpm build:leather`);
    }

    // A browser extension only loads via a persistent context, and `packages/core` owns the one
    // call that creates it (AD-1) — never `chromium.launch` here.
    const userDataDir = mkdtempSync(join(tmpdir(), `wallets-e2e-bdd-${testInfo.testId}-`));
    // Cleanup must run even when `launchContext` throws after `mkdtempSync` — otherwise failed
    // runs leak Chromium profiles (tens of MB each) into the temp dir.
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
      // Best-effort — a failed cleanup must not fail the test.
      rmSync(userDataDir, { recursive: true, force: true });
    }
  },

  page: async ({ context }: { context: BrowserContext }, use: (page: Page) => Promise<void>) => {
    // The dapp's own tab. Leather's onboarding pages open in the same context; giving the dapp its
    // own page keeps the steps' `page` unambiguous.
    const page = await context.newPage();
    await use(page);
  },
});

/**
 * Registers the coarse wallet steps this project ships, and hands back the same binders the
 * dapp-language steps in this folder are written with. The seed phrase, the driver and the wallet's
 * name in `@stacks/connect`'s picker are all injected here — which is why no `.feature` file in
 * this example mentions any of them.
 */
export const { Given, When, Then } = createWalletSteps({
  test,
  driver: leatherDriver,
  seedPhrase: wallet.seedPhrase,
  walletName: 'Leather',
  connectTestId: 'connect-wallet',
});

export { expect };
