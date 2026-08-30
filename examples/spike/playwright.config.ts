import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

// NFR2: Playwright's bundled Chromium only. Artifacts come from withWalletReporting + createExtensionTest.
export default withWalletReporting(
  defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    timeout: 120_000,
    use: {
      channel: 'chromium',
    },
  }),
);
