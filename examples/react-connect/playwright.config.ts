import { defineConfig } from '@playwright/test';

/**
 * NFR2: Playwright's bundled Chromium only. FR7-equivalent: video every run. Auto-starts the
 * real Vite dev server so `pnpm test` here is self-contained — no separate "run dev first" step.
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
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
