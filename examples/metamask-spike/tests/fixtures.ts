import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, type BrowserContext } from '@playwright/test';
import { launchContext } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/metamask/dist');

type Fixtures = {
  extensionContext: BrowserContext;
};

function requireExtensionBuilt(): void {
  if (existsSync(join(EXTENSION_PATH, 'manifest.json'))) return;
  throw new Error(
    'MetaMask is not built yet — run: pnpm build:metamask (or bash wallets/metamask/scripts/build-extension.sh)',
  );
}

export const test = base.extend<Fixtures>({
  extensionContext: async ({}, use, testInfo) => {
    requireExtensionBuilt();

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
