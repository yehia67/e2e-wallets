import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: './features/**/*.feature',
  steps: ['./steps/**/*.ts'],
});

export default defineConfig({
  testDir,
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
    cwd: join(import.meta.dirname, '../metamask-spike'),
    url: 'http://127.0.0.1:3456',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
