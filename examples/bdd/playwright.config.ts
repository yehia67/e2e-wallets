import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

/**
 * `bddgen` compiles `features/*.feature` into real Playwright spec files under `.features-gen/`,
 * and that generated directory — not `features/` — is what the runner points at. `pnpm test` runs
 * `bddgen && playwright test`, so the generated specs are never stale.
 */
const testDir = defineBddConfig({
  features: './features/**/*.feature',
  // `steps/fixtures.ts` must be in this glob: it exports the `test` object the generated specs
  // import, and registering the wallet steps is a side effect of loading it.
  steps: ['./steps/**/*.ts'],
});

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // Matches examples/react-connect. The one scenario that waits on a real testnet block (~10
  // minutes) raises its own ceiling with a `@timeout:` tag instead, so a stuck popup here still
  // fails in two minutes rather than twenty.
  timeout: 120_000,
  use: {
    channel: 'chromium',
    video: 'on',
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    // Reuses examples/react-connect's Vite app as the dapp under test — there is no second demo app.
    command: 'pnpm dev',
    cwd: join(import.meta.dirname, '../react-connect'),
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
