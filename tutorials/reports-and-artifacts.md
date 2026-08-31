# Reports and artifacts: seeing what the wallet actually did

A wallet test fails differently from a normal one. The dapp looks fine, the assertion times out, and the thing that went wrong happened inside a `chrome-extension://` popup that closed before you could look at it. A stack trace pointing at `expect(...).toBeVisible()` tells you nothing.

This tutorial wires up the three artifacts that do tell you something — a **video** of the run, a **screenshot of every open page including the wallet's own popup** for passed and failed tests, and a failure-only **trace** with DOM snapshots — and gets them attached to the test that produced them in Playwright's HTML report.

Two calls do it: `withWalletReporting` around your config, `createExtensionTest` for your fixture.

This tutorial consumes only public package exports. Registry status verified 2026-08-30: published
core `0.1.3` does not yet export either reporting helper, so this setup is blocked pending a core
release. Do not replace the package with a source checkout or local link. Once a compatible release
exists, install it in your dapp and verify the exports:

```bash
WALLETS_CORE_VERSION=replace-with-version-containing-reporting
npm install --save-dev "@wallets-e2e/core@${WALLETS_CORE_VERSION}" @playwright/test
node --input-type=module -e "const c=await import('@wallets-e2e/core'); for(const n of ['createExtensionTest','withWalletReporting']) if(!(n in c)) throw new Error('missing '+n)"
```

## What you get, and who actually produces it

The one genuinely surprising thing here is how little of this the package does.

Extensions only load through `chromium.launchPersistentContext` — a plain `chromium.launch` cannot
carry one, which is why the public `launchContext` package export owns context creation. The natural
assumption is that Playwright's artifact machinery ignores a context it did not create itself. That
assumption is wrong — checked against Playwright 1.62.1 and a real run:

| Artifact | Who produces it | How |
|---|---|---|
| **Trace** | **Playwright** | Its instrumentation hooks *every* context creation, `launchPersistentContext` included. Set `use.trace` and a trace is recorded and attached under the name `trace`, which is what makes the HTML report render a "view trace" link. |
| **Screenshot** | **Playwright** | Its screenshot recorder iterates every open page, not just the fixture's own — so passed and failed tests capture the dapp page **and** the wallet's `chrome-extension://` popup. Confirmed visually: the captured PNG is the real rendered wallet UI, not a blank frame. |
| **Video** | **this package** | Playwright writes the `.webm` (the launch call passes `recordVideo.dir`) but never attaches it to a test and never cleans it up — its video handling lives in an internal context factory that only serves `browser.newContext()`. Left alone you get orphaned `page@<hash>.webm` files in a shared directory, attributable to no test. That is exactly what this repo had before. |

So the honest division of labour:

- **`createExtensionTest`** gives you a real extension-loaded persistent context as the stock `context` / `page` fixtures, and attaches the recorded video to the test that produced it — deleting it instead when the test passed and you asked for failures only.
- **`withWalletReporting`** turns on the HTML reporter and sets the `video` / `screenshot` / `trace` modes, so Playwright's own trace and screenshot machinery has something to do.

Neither of them captures a trace or a screenshot. Playwright does that, and does it better than you would expect.

## Wiring it up

### 1. Wrap the config

```ts
// playwright.config.ts in your dapp
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

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
```

`withWalletReporting` adds `reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]` **only if you have not set `reporter` yourself**. The HTML report is unfiltered: passed, failed, skipped, and timed-out cases all appear. It fills in `use.video`, `use.screenshot` and `use.trace` **only where they are `undefined`**. Anything you set wins. If you assemble your own reporter list, take just the pair from `walletReporters({ outputFolder, open })` and spread it in.

### 2. Build the fixture

**Before** — the shape consumers previously hand-rolled. It is reproduced only to make the package
factory's value clear:

```ts
// tests/fixtures.ts — avoid this boilerplate
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, type BrowserContext } from '@playwright/test';
import { launchContext } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../.wallet-extensions/leather/dist');

export const test = base.extend<{ extensionContext: BrowserContext }>({
  extensionContext: async ({}, use, testInfo) => {
    if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
      testInfo.skip(true, `Leather is not built at ${EXTENSION_PATH}.`);
      return;
    }

    const userDataDir = mkdtempSync(join(tmpdir(), `wallets-e2e-spike-${testInfo.testId}-`));
    try {
      const context = await launchContext({
        extensionPath: EXTENSION_PATH,
        userDataDir,
        recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
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
});

export { expect } from '@playwright/test';
```

Thirty-four lines, and the videos it wrote were orphans.

**After** — use the public package fixture:

```ts
// tests/fixtures.ts in your dapp
import { join } from 'node:path';
import { createExtensionTest } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../.wallet-extensions/leather/dist');

export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-spike',
  extensionName: 'Leather',
  buildCommand: 'npm run wallet:prepare', // diagnostic text; define it in your dapp
  onMissingExtension: 'throw',
});

export { expect } from '@playwright/test';
```

The per-test temp profile, cleanup, build guard, and video attachment all move into the factory.
`extensionName` and `buildCommand` only shape the missing-build message; `buildCommand` is not
executed. `onMissingExtension` chooses skip or failure. Use the default `'throw'` in CI so a missing
wallet cannot produce a false green result.

`createExtensionTest` overrides the built-in `context` and `page` fixtures, so ordinary test code needs no new vocabulary. It also exposes `extensionContext`: the same object, under a name that reads better in a driver call.

### The playwright-bdd variant

Pass `base`. It must be playwright-bdd's `test` — `createBdd()` inspects the test object it is handed and rejects one that does not carry playwright-bdd's own fixtures, so building on `@playwright/test`'s `test` fails at step registration rather than mysteriously at run time.

```ts
// steps/fixtures.ts in your dapp
import { createExtensionTest } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
import { test as bddTest } from 'playwright-bdd';

export const test = createExtensionTest({
  base: bddTest,
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-bdd',
  extensionName: 'Leather',
  buildCommand: 'npm run wallet:prepare',
});

export const { Given, When, Then } = createWalletSteps({
  test,
  driver: leatherDriver,
  seedPhrase: wallet.seedPhrase,
  walletName: 'Leather',
  connectTestId: 'connect-wallet',
});
```

Overriding the built-in `context` name is what makes this work: bdd steps destructure the stock `{ context, page }` and get an extension-loaded browser without knowing extensions exist.

### Layering your own fixtures on top

`createExtensionTest` returns a normal Playwright `test`, so `.extend()` it like any other:

```ts
// tests/fixtures.ts in your dapp
export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e',
  extensionName: 'Leather',
  buildCommand: 'npm run wallet:prepare',
  onMissingExtension: 'throw',
}).extend<Fixtures>({
  unlockedContext: async ({ extensionContext }, use) => {
    await leatherDriver.importWallet(extensionContext, wallet.seedPhrase);
    await use(extensionContext);
  },
  // connectedApp, connectedAppOnTestnet — each building on the one above
});
```

## Running and opening

```bash
npx playwright test
npx playwright show-report playwright-report
```

`open: 'never'` is the default, so a run never hijacks your browser — which matters most in CI, where a report that opens itself hangs the job. Open it when you want it.

Each test in the report carries its own attachments. The first video is attached under the name `video`, which is the name the HTML reporter special-cases into an actual player; a context that opened several pages contributes `video-2`, `video-3`, and so on.

## Reading a failure

Four artifacts, four different questions. Reach for them in this order:

| Question | Artifact |
|---|---|
| What did the user see? | **`video`** — the whole run, in order. Fastest way to find *when* it went wrong. |
| What was the wallet popup showing when it broke? | **`screenshot`** — one per open page, the extension popup included. Usually the actual answer: a network mismatch, an error banner, an approve button that never enabled. |
| What exactly did the test do? | **`trace`** — every action with before/after DOM snapshots, plus network and console. Where you find out a click landed on the wrong element. |
| Why did the assertion fail? | **`error-context`** — Playwright's own aria snapshot of the page at the point of error. |

The trace opens from the report's "view trace" link, or on its own:

```bash
npx playwright show-trace test-results/replace-with-test-directory/trace.zip
```

You can also drag `trace.zip` onto [trace.playwright.dev](https://trace.playwright.dev) — it runs entirely in the browser and uploads nothing, which makes it the practical way to look at a trace a CI job produced.

One habit worth building: **watch the video first, then open the trace at that moment.** The video tells you the popup appeared and then vanished; the trace tells you which of your steps closed it.

## Tuning

Three knobs, one vocabulary — `ArtifactMode` is `'on' | 'off' | 'only-on-failure' | 'retain-on-failure'`.

| Option | Package default | Meaning |
|---|---|---|
| `use.video` | `'on'` | Always record, always attach. A wallet run's video is small and it is the artifact you reach for first. |
| `use.screenshot` | `'on'` | On every result, capture every open page — dapp and popup — including successes. |
| `use.trace` | `'retain-on-failure'` | Always record, keep only on failure. |

Set them in the config's `use` block exactly as you would for any Playwright project:

```ts
export default withWalletReporting(
  defineConfig({
    use: {
      channel: 'chromium',
      trace: 'on',                  // debugging a flaky connect flow: keep every trace
      video: 'retain-on-failure',
    },
  }),
);
```

That is the whole story for **trace and screenshots**: `use.trace` and `use.screenshot` are ordinary Playwright options, Playwright reads them itself, and they always win.

**Video is the one that also has a per-fixture override**, because video is the one this package owns:

```ts
export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  artifacts: { video: 'retain-on-failure' },
});
```

`artifacts` takes `video` and nothing else. So the two chains are:

- **`video`** — the fixture's `artifacts.video` first, then the project's `use.video`, then the package default `'on'`.
- **`trace` and `screenshot`** — the project's `use` wins, full stop. The factory does supply the package defaults as `.extend()` option defaults, so a fixture built without `withWalletReporting` still traces and screenshots; a `use` value overrides them in the normal Playwright way.

There used to be `artifacts.trace` and `artifacts.screenshot` too. They were removed rather than fixed: a project's `use` beats an `.extend()`-supplied option default, and `withWalletReporting` always fills `use.trace` and `use.screenshot`, so both knobs were silently ignored in the setup this tutorial recommends. An option that quietly does nothing is worse than no option.

In practice: set all three in `use` and it behaves as you expect. Reach for `artifacts` only when one test file needs different **video** handling from the rest of the project.

`'on-first-retry'` and `'on-all-retries'` are accepted for `video` and treated as `'retain-on-failure'`: the recording is written on the first attempt regardless, so there is nothing to gain by waiting for a retry.

"Failure" here means `testInfo.status !== testInfo.expectedStatus`, not `status !== 'passed'`. A test marked `test.fail()` that duly failed did what it was told, and does not spend an artifact saying so.

### Where the raw files land

Playwright gives each test its own directory under `test-results/`, and everything goes there:

```
test-results/
└── 1-1-load-and-unlock-Story--9d703-er-extension-video-recorded/
    ├── videos/page@814de840bc31e633a271ca4a43c44841.webm   # raw recording
    ├── attachments/video-4b00f6f9….webm                    # what the report links to
    ├── test-failed-1.png                                   # one per page, on failure
    ├── trace.zip
    └── error-context.md
```

The `page@<hash>.webm` names are Chromium's, not yours — meaningless on purpose, which is exactly why an unattached video is useless and why the attachment step has to exist. Videos the run decided not to keep are deleted rather than left behind.

The Chromium profile itself is a fresh temp directory per test (`profilePrefix` names it) and is removed when the test ends, pass or fail. No wallet state leaks from one test into the next.

## CI

`playwright-report/`, `test-results/` and `blob-report/` are all gitignored. Upload them as job artifacts instead:

```yaml
- name: Upload Playwright report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: |
      playwright-report/
      test-results/
    retention-days: 7
```

`if: always()` matters — the interesting run is the failed one, and a step that defaults to running only on success never fires for it.

Three things worth knowing before turning everything on:

- **`trace: 'retain-on-failure'`, not `'on'`.** A failing wallet run's `trace.zip` carries DOM snapshots of the dapp *and* of every popup frame, and reaches several megabytes without trying. Multiply that by a full suite kept on every green run and artifact storage becomes the slowest part of the job. Failures are the only traces anyone opens.
- **Treat artifacts as sensitive.** Video is on by default and records the wallet's own UI, seed-phrase entry included. Fine for a throwaway fixture wallet; not fine if the wallet ever holds value. See the root README's *Bring your own account*.
- **A green run that skipped everything is not a green run.** With `onMissingExtension: 'skip'`, a CI job that forgot to build the extension reports success having tested nothing. Build the extension in the job, or set `'throw'` there.

## Related

- [`quick-start.md`](./quick-start.md) — the driver API these tests are written against.
- [`feature-files.md`](./feature-files.md) — the same artifacts, driven from Gherkin scenarios.
