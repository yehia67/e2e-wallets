import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

// NFR2: Playwright's bundled Chromium only. Auto-starts the real Vite dev server.
export default withWalletReporting(
  defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    timeout: 120_000,
    use: {
      channel: 'chromium',
      baseURL: 'http://localhost:5173',
    },
    webServer: {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  }),
);
