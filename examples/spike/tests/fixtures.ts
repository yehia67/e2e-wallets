import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, type BrowserContext } from '@playwright/test';
import { launchContext } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

type Fixtures = {
  /** A real, launched Leather context — video-recorded, auto-closed, skips if the extension isn't built. */
  extensionContext: BrowserContext;
};

/**
 * Playwright best practice: push setup/teardown into a fixture rather than repeating
 * `try { ... } finally { context.close() }` and the same `test.skip` guard in every test.
 */
export const test = base.extend<Fixtures>({
  extensionContext: async ({}, use, testInfo) => {
    testInfo.skip(
      !existsSync(join(EXTENSION_PATH, 'manifest.json')),
      'Leather is not built yet — run: bash wallets/leather/scripts/build-extension.sh',
    );

    const context = await launchContext({
      extensionPath: EXTENSION_PATH,
      userDataDir: mkdtempSync(join(tmpdir(), `wallets-e2e-spike-${testInfo.testId}-`)),
      recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
    });
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
