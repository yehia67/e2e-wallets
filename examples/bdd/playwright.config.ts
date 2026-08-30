import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';
import { defineBddConfig } from 'playwright-bdd';

// `bddgen` compiles features/ into .features-gen/; the runner points at the generated dir, not features/.
const testDir = defineBddConfig({
  features: './features/**/*.feature',
  steps: ['./steps/**/*.ts'],
});

export default withWalletReporting(
  defineConfig({
    testDir,
    fullyParallel: false,
    workers: 1,
    timeout: 120_000,
    use: {
      channel: 'chromium',
      baseURL: 'http://localhost:5173',
    },
    webServer: {
      command: 'pnpm dev',
      cwd: join(import.meta.dirname, '../react-connect'),
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  }),
);
