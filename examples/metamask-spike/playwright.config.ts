import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

export default withWalletReporting(
  defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    timeout: 300_000,
    use: {
      channel: 'chromium',
      baseURL: 'http://127.0.0.1:3456',
    },
    webServer: {
      command: 'pnpm exec vite --config vite.config.ts --host 127.0.0.1',
      url: 'http://127.0.0.1:3456',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  }),
);
