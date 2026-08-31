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

The scenario is application-owned product language: no seed phrase, network-switch implementation,
extension path, or popup mechanics beyond a single approval sentence.

## Setup

```bash
WALLETS_CORE_VERSION=replace-with-version-containing-createExtensionTest
WALLETS_LEATHER_VERSION=replace-with-compatible-version
npm install --save-dev \
  "@wallets-e2e/core@${WALLETS_CORE_VERSION}" \
  "@wallets-e2e/leather@${WALLETS_LEATHER_VERSION}" \
  @playwright/test playwright-bdd
npx playwright install chromium
```

The replacement values are deliberately invalid. There was no published pair supporting this exact
fixture on 2026-08-30; do not run the install until compatible versions exist.

[`playwright-bdd`](https://vitalets.github.io/playwright-bdd/) is an **optional** peer of `@wallets-e2e/core`. Importing `@wallets-e2e/core` never requires it; only the `@wallets-e2e/core/bdd` subpath does.

**Use `playwright-bdd`, never `@cucumber/cucumber`.** cucumber-js ships its own runner and World and cannot consume Playwright fixtures, so the extension-loaded browser context never reaches your steps.

This tutorial requires public core exports `createExtensionTest` and `createWalletSteps`. Core
`0.1.3` publishes the BDD subpath but not `createExtensionTest`, so verify both exports before using
this exact fixture. If no published version contains both, package consumption is blocked pending a
release; do not link repository source. Build the real Leather extension separately as described in
the [quick start](./quick-start.md), then point the fixture at its unpacked `dist` directory.

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
import { createExtensionTest } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
import { resolve } from 'node:path';
// `base` must be playwright-bdd's `test`: `createBdd()` rejects any test that doesn't carry its fixtures.
import { test as bddTest } from 'playwright-bdd';

const EXTENSION_PATH = resolve(
  process.env.LEATHER_EXTENSION_PATH ?? '.wallet-extensions/leather/dist',
);

// The built-in `context`/`page` are overridden here because the bdd steps read those stock names.
export const test = createExtensionTest({
  base: bddTest,
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-bdd',
  extensionName: 'Leather',
  buildCommand: 'npm run wallet:prepare', // diagnostic text; define this in your dapp
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

**Not in the feature file:** seed phrases, extension paths, `switchNetwork`, raw `Page` / popup listeners. Those stay in fixtures and in `@wallets-e2e/core/bdd`.

Do **not** split connect into granular `Given I click connect` / `When I approve` pairs that put the click outside `trigger()` — that reopens the timeout trap the coarse step exists to hide.

## Using this on a large production project

Everything above gets one `.feature` file working. What follows is what changes when there are forty of them and several teams writing them.

### Three step layers, three owners

The single most useful discipline is knowing which layer a step belongs to before writing it.

| Layer | Lives in | Owned by | Changes when |
|---|---|---|---|
| **Wallet steps** | `@wallets-e2e/core/bdd` | this package | The wallet protocol changes. You never write these. |
| **Shared dapp steps** | your own `steps/shared/` | QA / platform team | Your app's cross-cutting vocabulary changes (auth, navigation, common assertions) |
| **Feature-local steps** | `steps/<area>/` | the team owning that area | Only that area changes |

A step that two features need belongs in shared. A step one feature needs stays local. Promoting local → shared is a deliberate review decision, never automatic — that promotion is what keeps the shared vocabulary small enough to hold in your head.

### Guard against step explosion

The failure mode of BDD at scale is not too few steps, it's too many near-identical ones: `I click send`, `I press the send button`, `I hit send`. Three steps, one behaviour, and now nobody can find the one that exists.

Two rules that prevent it:

1. **A new step must be justified by a second caller.** If only one scenario will ever say it, ask whether the scenario is written at the wrong altitude.
2. **Grep before you write.** `grep -rh "^\s*\(Given\|When\|Then\)(" steps/ | sort -u` prints your entire vocabulary. If it doesn't fit on a screen or two, you have a curation problem, not a coverage problem.

Run that grep in code review, not just when writing.

### Write declaratively — that's the entire point

The coarse wallet steps this package ships are coarse on purpose. Your steps should match that altitude, or the feature file stops being reviewable and the whole exercise is wasted effort:

```gherkin
# Imperative — a script in Gherkin costume. A product owner learns nothing from this.
When I click the "Send" button
And I type "1" into the amount field
And I click "Confirm"
And I wait for the popup
And I click "Approve"

# Declarative — states intent. This is what a PO can actually review and correct.
When I request a transfer of 1 STX
And I approve the wallet popup
```

The imperative version also breaks every time the UI moves. The declarative one only breaks when the *behaviour* changes — which is exactly when a test should break.

### Make product-owner review a real step, not a hope

The readable file is worthless if nobody reads it. What makes it stick:

- **Put `*.feature` under CODEOWNERS** with the product owner as a required reviewer. A PR touching behaviour then cannot merge without them seeing the sentences.
- **Review the `.feature` diff alone.** `git diff --stat -- '**/*.feature'` in the PR template gives them a two-line summary instead of a 600-line TypeScript diff.
- **Write the feature file first, get it approved, then implement.** A `.feature` reviewed after the code is a transcript. Reviewed before, it's a specification — and disagreements surface while they're still cheap.
- **Treat a PO's wording correction as a code change.** If they say "we don't call it a transfer, we call it a payout", rename the step. The vocabulary is theirs.

### Split fast scenarios from slow ones

`Then the transaction is mined` waits on real testnet blocks. At ~10 minutes each, a suite of thirty such scenarios cannot run on every pull request — and Hiro's public API is rate-limited, so hammering it in parallel makes things worse, not faster.

Tag by cost and run the tiers separately. playwright-bdd puts tags into the generated test title, so Playwright's own `--grep` filters them:

```gherkin
@chain @timeout:1_200_000
Scenario: A connected visitor sends 1 STX and it lands on chain
```

```bash
# Every PR: connect, UI assertions, popup approvals — no chain waits.
playwright test --grep-invert @chain

# Nightly / pre-release only.
playwright test --grep @chain
```

Keep `@chain` scenarios few and high-value. Most regressions live in connect and approval flows, which cost seconds; the on-chain confirmation is proving the pipe works, and it doesn't need re-proving thirty times a night.

### Parallelism is capped by the wallet, not by Playwright

`workers: 1` in the example config is a real constraint, not caution. Each worker needs its own persistent Chromium profile with the extension loaded, and a funded fixture wallet — and two workers sharing one wallet will race on nonces and produce failures that look random.

To scale past one worker you need **one funded wallet per worker**, keyed off `testInfo.parallelIndex`, with the profile directory already unique per test (as the fixture does). Budget for the faucet being rate-limited: fund the pool ahead of time out-of-band, never inside the test run.

Until you've done that, leave `workers: 1` and get your speed from the tier split above instead.

### CI

```bash
pnpm test
```

Always set it. Without it, a CI job with no extension build reports green while skipping every scenario — a passing pipeline that tested nothing.

The rest of the CI shape:

- **Cache the built extension** keyed on the pinned `leather-io/extension` commit. Building from source on every run dominates the job time.
- **Pin that commit.** A moving `main` makes wallet UI changes arrive as mystery failures in unrelated PRs.
- **Keep the seed in a secret**, injected as `WALLETS_E2E_SEED_PHRASE` — never a checked-in default in a real project. Video recording is on by default, so treat artifacts as sensitive if the wallet ever holds anything.
- **Publish `.features-gen/` and the HTML report as artifacts** on failure. A recording of the real popup is usually faster to diagnose from than a stack trace. `createExtensionTest` attaches the video, and Playwright adds the trace and a screenshot of every open page — see [`reports-and-artifacts.md`](./reports-and-artifacts.md) for the wiring and the retention modes.

### Anti-patterns, all of them real

| Don't | Why |
|---|---|
| Split connect into `Given I click connect` / `When I approve` | Puts the click outside `trigger()` and reopens the 10-second-timeout trap |
| Re-implement popup catching in your own step | That logic belongs to the driver; yours will drift from it |
| Put seed phrases, network names, or extension paths in a `.feature` | Breaks the one property that justifies the file existing |
| Use `Scenario Outline` across networks | Only `mainnet` and `testnet4` are honoured; the rest throw |
| Assert on wallet internals from a dapp step | The driver already verifies the popup's origin and clean close |
| Let a step name outlive the product's language | A stale vocabulary is how PO review quietly stops happening |

## Consumer project files

Keep the complete setup in your application:

| File | Role |
|---|---|
| `features/transfer.feature` | Reviewable product scenario. |
| `steps/fixtures.ts` | Package-backed extension context and wallet steps. |
| `steps/transfer.steps.ts` | Your dapp-specific language and selectors. |
| `playwright.config.ts` | `defineBddConfig`, application server, and artifact policy. |

Run `npx bddgen && npx playwright test`. A missing extension should fail in CI; a green job that
skipped every wallet scenario is not evidence.

## Still stuck?

- Opaque 10s timeout on connect/approve → a click ran outside `trigger()`; use `queueWalletTrigger`.
- Steps bind but there's no extension → `test` wasn't passed into `createWalletSteps`, or wasn't from `playwright-bdd`.
- Driver / seed errors naming `createWalletSteps` → wiring mistake at registration; read the message.
- For the TypeScript driver API (sign, transfer, contract call without Gherkin), see [`quick-start.md`](./quick-start.md).
