# Feature files: Gherkin scenarios against a real Leather wallet

[`quick-start.md`](./quick-start.md) shows the TypeScript / Playwright driver API. This tutorial is the same stack — real Leather extension, real popups, real testnet — expressed as **Gherkin `.feature` files** so people who don't read Playwright TypeScript can still review what the automation does.

`@wallets-e2e/core/bdd` ships the **wallet** steps. You write only the **dapp** steps (your buttons, your txid element). Never re-implement seed import, network switching, or popup catching yourself.

## A real, working example

```gherkin
Feature: Sending STX from the demo app

  Scenario: The app shows the address of the wallet that connected
    Given I am connected to Stacks testnet
    Then my wallet address is shown

  @timeout:1_200_000
  Scenario: A connected visitor sends 1 STX and it lands on chain
    Given I am connected to Stacks testnet
    When I request a transfer of 1 STX
    And I approve the wallet popup
    Then a transaction id is shown
    And the transaction is mined
```

Not hypothetical — this is (lightly trimmed) `examples/bdd/features/transfer.feature`, running against `examples/react-connect`'s Vite app and the real Leather extension today. Product language only: no seed phrase, no network-switch sentence, no extension path, no popup mechanics beyond a single approval line.

## Setup

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/leather @playwright/test playwright-bdd
```

[`playwright-bdd`](https://vitalets.github.io/playwright-bdd/) is an **optional** peer of `@wallets-e2e/core`. Importing `@wallets-e2e/core` never requires it; only the `@wallets-e2e/core/bdd` subpath does.

**Use `playwright-bdd`, never `@cucumber/cucumber`.** cucumber-js ships its own runner and World and cannot consume Playwright fixtures, so the extension-loaded browser context never reaches your steps.

Build (or copy) the real Leather extension once, same as the quick start — then point your launch fixture at that unpacked `dist/` (see below).

In this monorepo:

```bash
pnpm build:leather
pnpm --filter @wallets-e2e/core build       # ./bdd is consumed from dist/
pnpm --filter @wallets-e2e/example-bdd test # bddgen && playwright test
```

## Wire the runner

`bddgen` compiles each `.feature` into a real Playwright spec under `.features-gen/`. Your `test` script must run `bddgen` **before** `playwright test`, or the runner looks at stale (or missing) generated files.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: './features/**/*.feature',
  // fixtures.ts must be in this glob: it exports `test` and registers wallet steps as a side effect
  steps: ['./steps/**/*.ts'],
});

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1, // Leather's persistent profile cannot be shared across parallel workers
  timeout: 120_000,
  use: {
    channel: 'chromium',
    baseURL: 'http://localhost:5173', // your dapp
  },
  webServer: {
    command: 'pnpm dev', // however you start your dapp
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

```json
{ "scripts": { "test": "bddgen && playwright test" } }
```

## Register the wallet steps

`createWalletSteps` needs the Playwright `test` object that carries your **extension** context — that must come from `playwright-bdd`, not `@playwright/test`. Hand it the driver, seed, and wallet name; it returns the same `Given` / `When` / `Then` binders you use for dapp steps.

```ts
// steps/fixtures.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { launchContext } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
import { test as base } from 'playwright-bdd';

const EXTENSION_PATH = 'wallets/leather/dist'; // your unpacked build
const REQUIRE_EXTENSION = process.env.WALLETS_E2E_REQUIRE_EXTENSION === '1';

export const test = base.extend({
  context: async ({}, use, testInfo) => {
    const built = existsSync(join(EXTENSION_PATH, 'manifest.json'));
    if (!built && REQUIRE_EXTENSION) {
      throw new Error(`Leather is not built at ${EXTENSION_PATH}`);
    }
    testInfo.skip(!built, 'Leather is not built yet');

    const userDataDir = mkdtempSync(join(tmpdir(), `wallets-e2e-${testInfo.testId}-`));
    try {
      const context = await launchContext({
        extensionPath: EXTENSION_PATH,
        userDataDir,
        recordVideoDir: 'test-results/videos',
      });
      try {
        await use(context);
      } finally {
        await context.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  },

  page: async ({ context }: { context: BrowserContext }, use: (page: Page) => Promise<void>) => {
    const page = await context.newPage();
    await use(page);
  },
});

export const { Given, When, Then } = createWalletSteps({
  test,
  driver: leatherDriver,
  seedPhrase: wallet.seedPhrase, // prefer WALLETS_E2E_SEED_PHRASE — see quick-start
  walletName: 'Leather',
  connectTestId: 'connect-wallet', // data-testid on your dapp's connect button
});
```

Without `test`, `createBdd` silently binds to stock Playwright fixtures — a browser with **no** extension — and the first step dies as an opaque timeout inside `importWallet`. The library throws at registration if you forget it.

## Built-in wallet steps

| Step | What it does |
|---|---|
| `Given I am connected to {word} {word}` | Import seed → switch network (if not mainnet) → connect dapp. Example: `Stacks testnet` → chain `stacks`, network `testnet4`. |
| `When I approve the wallet popup` | Runs the **queued** dapp click inside `confirmTransaction`'s `trigger()`, then approves Leather. |
| `Then the transaction is mined` | Polls the Stacks API for the txid you recorded; fails on `abort_by_*`, not only on timeout. |

Optional `createWalletSteps` knobs: `connect` (custom connect flow), `connectTestId`, `rpcUrl`, `minedTimeoutMs` (default 15 minutes).

Network words the parser accepts today: `mainnet`, `testnet` / `testnet4`. Unknown words throw immediately, naming the word and listing valid values — before any browser work.

## The one rule for your own steps: queue, don't click

Both `connectToDapp` and `confirmTransaction` register `context.waitForEvent('page')` **before** awaiting your `trigger()`. A step that clicks the dapp button itself opens the popup with nobody listening and dies on a bare 10-second timeout.

So every dapp action that opens a wallet popup **queues** the click; `When I approve the wallet popup` is what runs it:

```ts
// steps/transfer.steps.ts
import { queueWalletTrigger, recordTransactionId } from '@wallets-e2e/core/bdd';
import { expect, Then, When } from './fixtures.js';

Then('my wallet address is shown', async ({ page }) => {
  await expect(page.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });
});

When('I request a transfer of 1 STX', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('send-stx').click(); // runs inside the driver's trigger(), not here
  });
});

Then('a transaction id is shown', async ({ context, page }) => {
  await expect(page.getByTestId('transfer-txid')).toBeVisible({ timeout: 15_000 });
  const txid = (await page.getByTestId('transfer-txid').innerText())
    .replace(/^txid:\s*/, '')
    .trim();
  expect(txid).toMatch(/^[0-9a-f]{64}$/i);
  recordTransactionId(context, txid); // feeds `Then the transaction is mined`
});
```

Queueing twice without an approval throws. Approving with nothing queued throws. Both messages name the fix.

## Timeouts and real testnet

`Then the transaction is mined` spends **real** testnet STX and waits on **real** blocks (~10 minutes is normal). The step's default poll allows 15 minutes — far above Playwright's default test timeout — so any scenario that uses it needs a scenario-level tag or Playwright kills the test first:

```gherkin
@timeout:1_200_000
Scenario: A connected visitor sends 1 STX and it lands on chain
  ...
  And the transaction is mined
```

That `@timeout:` tag is playwright-bdd syntax, not product language. Keep it; without it the mined step cannot finish.

## What belongs in the `.feature` vs what doesn't

**In the feature file:** what a product owner means — connected, requested a transfer, approved, saw a txid, mined.

**Not in the feature file:** seed phrases, extension paths, `switchToTestnetNetwork`, raw `Page` / popup listeners. Those stay in fixtures and in `@wallets-e2e/core/bdd`.

Do **not** split connect into granular `Given I click connect` / `When I approve` pairs that put the click outside `trigger()` — that reopens the timeout trap the coarse step exists to hide.

## The `examples/bdd/` folder

Full, currently-passing reference:

| File | Role |
|---|---|
| `examples/bdd/features/transfer.feature` | Readable artifact |
| `examples/bdd/steps/fixtures.ts` | Extension context + `createWalletSteps` |
| `examples/bdd/steps/transfer.steps.ts` | Dapp-language steps only |
| `examples/bdd/playwright.config.ts` | `defineBddConfig` + webServer → react-connect |

```bash
pnpm --filter @wallets-e2e/example-bdd test
```

If Leather isn't built, scenarios **skip** rather than fail. For CI (or any run that must actually exercise the extension):

```bash
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-bdd test
```

## Still stuck?

- Opaque 10s timeout on connect/approve → a click ran outside `trigger()`; use `queueWalletTrigger`.
- Steps bind but there's no extension → `test` wasn't passed into `createWalletSteps`, or wasn't from `playwright-bdd`.
- Driver / seed errors naming `createWalletSteps` → wiring mistake at registration; read the message.
- For the TypeScript driver API (sign, transfer, contract call without Gherkin), see [`quick-start.md`](./quick-start.md).
