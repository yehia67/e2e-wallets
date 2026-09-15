# Setup and reporting

Use this reference when integrating the packages, creating Playwright fixtures, configuring reports,
or producing artifacts for review.

For a consumer-project layout and complete package-import examples, read
[package-consumer-examples.md](package-consumer-examples.md). Do not translate the monorepo's
workspace commands or source paths directly into consumer instructions.

## Choose a safe acquisition path

Authoritative package locations:

- `@wallets-e2e/core`: <https://www.npmjs.com/package/@wallets-e2e/core>
- `@wallets-e2e/metamask`: <https://www.npmjs.com/package/@wallets-e2e/metamask>
- `@wallets-e2e/leather`: <https://www.npmjs.com/package/@wallets-e2e/leather>
- Repository metadata and issue tracker: <https://github.com/yehia67/e2e-wallets>

### Compatibility status verified 2026-08-30

`core`, `leather` and `metamask` at `0.1.4` are a verified compatible set, carrying `EvmNetwork`,
`EVM_NETWORKS`, the injected EVM RPC, `createExtensionTest` and the reporting API. All five example
suites pass against them installed from the registry.

Pin exact versions, and confirm the registry yourself rather than trusting this note to stay current:

```bash
npm view @wallets-e2e/core version
npm view @wallets-e2e/metamask version dependencies
```

Never substitute a GitHub checkout, local package link, or workspace dependency in consumer
instructions.

### Never import the packages' own wallet fixtures

`@wallets-e2e/leather/fixtures/wallet.js` and `@wallets-e2e/metamask/fixtures/wallet.js` are
published, so they resolve — but they are the toolkit's own contributor fixtures, not a consumer
API. Read the `WALLETS_E2E_*` variables in your own project instead.

- The Leather fixture falls back to a seed phrase baked into the published package. Every project
  importing it shares one publicly known wallet.
- The MetaMask fixture throws at import time unless `WALLETS_E2E_SEED_PHRASE`,
  `WALLETS_E2E_ETH_ADDRESS` and `WALLETS_E2E_PASSWORD` are all set, and its error text names a
  repository script that the package does not ship.
- Both drivers' `importWallet` verifies the unlocked account against an expected address, so your
  own seed needs its matching address too: `WALLETS_E2E_ETH_ADDRESS` for MetaMask,
  `WALLETS_E2E_MAINNET_ADDRESS` and `WALLETS_E2E_TESTNET_ADDRESS` for Leather. Supplying the seed
  alone surfaces as an address mismatch rather than a missing-configuration error.

### Published package commands

```bash
# Leather (Stacks)
pnpm add -D @wallets-e2e/core@0.1.4 @wallets-e2e/leather@0.1.4 @playwright/test

# MetaMask (EVM)
pnpm add -D @wallets-e2e/core@0.1.4 @wallets-e2e/metamask@0.1.4 @playwright/test
```

Package installation modifies dependency files and downloads executable dependencies. Inspect the
target project and obtain the authority required by the active agent environment before running it.

## Prepare an extension

`@playwright/test` is a peer dependency. Use the project's existing package manager and lockfile.

The test needs an unpacked extension directory containing `manifest.json`. Use the consumer
project's documented preparation command or copy a verified unpacked build into a stable gitignored
path. The package-consumer guide includes a direct pinned MetaMask download and a Leather
source-build path. Never use toolkit repository scripts or silently download “latest” during a test
run.

Validate the extension path before debugging selectors. A missing `manifest.json` is a setup error,
not a wallet timeout.

## Preferred fixture

Use `createExtensionTest`; it creates a fresh temporary Chromium profile for each test, loads the
extension, overrides the stock `context` and `page` fixtures, records every page, closes the context
to flush videos, attaches them to the current test, and removes the temporary profile.

```ts
// tests/fixtures.ts
import { resolve } from 'node:path';
import { createExtensionTest } from '@wallets-e2e/core';

const EXTENSION_PATH = resolve(
  process.env.METAMASK_EXTENSION_PATH ?? '.wallet-extensions/metamask/dist',
);

export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'my-dapp-wallet',
  extensionName: 'MetaMask', // or Leather
  // This text is shown on a missing build; it is not executed by createExtensionTest.
  buildCommand: 'npm run wallet:prepare',
  // Prefer throw in CI. Use skip locally only when an absent extension is intentionally optional.
  onMissingExtension: process.env.CI ? 'throw' : 'skip',
});

export { expect } from '@playwright/test';
```

Tests receive `{ context, page, extensionContext }`. `context` and `extensionContext` are the same
persistent extension-loaded context; `extensionContext` is the explicit wallet-facing alias.

Use `launchContext` directly only when the fixture factory cannot fit an existing custom fixture.
When doing so, create a unique profile directory, close the context in `finally`, and clean the
profile. Do not call `chromium.launch()` for an extension; Chromium extensions require a persistent
context.

## HTML report and artifact defaults

Wrap the existing configuration. Preserve all unrelated config and any explicit artifact overrides:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

export default withWalletReporting(
  defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    use: {
      channel: 'chromium',
      baseURL: 'http://127.0.0.1:3000',
    },
    webServer: {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
    },
  }),
);
```

`withWalletReporting` adds the list reporter plus an unfiltered HTML reporter at
`playwright-report/index.html`. Passed, failed, skipped, and timed-out cases all appear. It fills only
undefined settings; caller-provided `reporter`, `use.video`, or `use.trace` wins.

Package defaults:

| Setting | Default | Result |
|---|---|---|
| `use.video` | `'on'` | Record and attach videos for passed and failed tests. |
| `use.screenshot` | forced `'off'` | The fixture takes screenshots instead — see below. |
| `use.trace` | `'retain-on-failure'` | Record traces, retain them only for unexpected failures. |

Override video and trace in `use` when storage policy requires it. The fixture also accepts
`artifacts: { video: ..., screenshot: ... }`; trace remains an ordinary Playwright `use` option.

### Screenshots are the fixture's, not Playwright's

Playwright screenshots **every page in the context the moment a test body ends** — before any
fixture can filter — and an extension context holds pages nobody wants to look at: the persistent
context's initial `about:blank`, and a wallet's invisible worker pages such as MetaMask's
`offscreen.html`. Each one costs a blank image in the report.

So `withWalletReporting` sets `use.screenshot` to `'off'` and the fixture captures its own, while
the pages are still open, skipping the ones that show nothing. A caller's `use.screenshot` is not
ignored: it is carried over as the fixture's mode, so `'only-on-failure'` still means only on
failure. `artifacts: { screenshot: ... }` beats both.

Screenshots are named like recordings: `screenshot`, then `screenshot-wallet-approval` and
`screenshot-wallet`, numbered when there is more than one of a kind.

Persistent contexts also record one video per page. The `page` fixture takes over the context's
initial blank page rather than opening a second one, and recordings of pages that showed nothing —
blank pages and invisible worker pages alike — are discarded instead of attached.

The package attaches useful HTTP(S) dapp recordings first, wallet extension pages next, and other
non-blank pages after those. The wallet's home page is open for the whole run and idle for nearly
all of it, so its recording is dropped unless it is the only one — pass
`artifacts: { walletHomeVideo: true }` to keep it. Its screenshot is kept either way: one still of
where the wallet ended up is worth having.

Each attachment is named after what it shows: `video` for the first kept recording, which is the
name Playwright's HTML reporter special-cases into a player, then `video-wallet-approval` for a
wallet's approval window, `video-wallet` for its other pages, and `video-page` for anything else.
Several recordings of the same kind are numbered — `video-wallet-approval-2` and so on — so a run
with two approvals stays readable without opening each one.

## Generate and review evidence

Run the intended scope using the package manager already present:

```bash
pnpm exec playwright test
pnpm exec playwright show-report
```

For an artifact regression, a temporary test may contain one passing case and one deliberate failed
assertion. Label the failure clearly, run only that file, preserve its report, and remove the
temporary spec afterwards. Never count the deliberate nonzero exit as a product-test regression.

Review at least:

1. The HTML summary lists every expected case and correct outcome.
2. A passed result has `test-finished-*.png`; a failed result has `test-failed-*.png`.
3. The primary `video` visibly shows the dapp or wallet rather than a permanently blank page.
4. Wallet screenshots show the meaningful UI state (connect, confirmation, permission, signature,
   network, or error) without exposing a valuable secret.
5. Failed cases retain `trace.zip` and `error-context.md` when applicable.

When handing off, link the exact report, primary video, representative successful and failed
screenshots, trace, and a short Markdown summary containing commands and pass/fail/skip counts.

## CI artifact upload

Build the selected extension before tests, keep spending tests behind a secret/variable gate, and
upload reports even if tests fail:

```yaml
- name: Run wallet tests
  run: pnpm exec playwright test

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

Use a retention period appropriate for sensitive wallet UI. Never publish reports from a wallet
that holds value.
