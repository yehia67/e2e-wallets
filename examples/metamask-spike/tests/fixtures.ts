import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, type BrowserContext } from '@playwright/test';
import { launchContext } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/metamask/dist');

type Fixtures = {
  /** A real, launched MetaMask context — video-recorded, auto-closed, skips if extension isn't built. */
  extensionContext: BrowserContext;
};

function requireExtensionBuilt(testInfo: { skip: (condition: boolean, reason: string) => void }): void {
  const built = existsSync(join(EXTENSION_PATH, 'manifest.json'));
  if (!built && process.env.WALLETS_E2E_REQUIRE_EXTENSION === '1') {
    throw new Error(
      'MetaMask is not built yet — run: pnpm build:metamask (or bash wallets/metamask/scripts/build-extension.sh)',
    );
  }
  testInfo.skip(
    !built,
    'MetaMask is not built yet — run: pnpm build:metamask',
  );
}

export const test = base.extend<Fixtures>({
  extensionContext: async ({}, use, testInfo) => {
    requireExtensionBuilt(testInfo);

    const context = await launchContext({
      extensionPath: EXTENSION_PATH,
      userDataDir: mkdtempSync(join(tmpdir(), `wallets-e2e-metamask-spike-${testInfo.testId}-`)),
      recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
    });
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
