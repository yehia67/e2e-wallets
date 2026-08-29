import { defineConfig } from '@playwright/test';

/**
 * NFR2: Playwright's bundled Chromium only. FR7: video on every run.
 * The static dapp is served by Vite on port 3456 so MetaMask sees a real http:// origin.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    channel: 'chromium',
    video: 'on',
    baseURL: 'http://127.0.0.1:3456',
  },
  webServer: {
    command: 'pnpm exec vite --config vite.config.ts --host 127.0.0.1',
    url: 'http://127.0.0.1:3456',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
