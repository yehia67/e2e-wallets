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

### Compatibility status verified 2026-09-17

`core@0.1.7` with `metamask@0.2.0`, and `core@0.1.7` with `leather@0.1.4`, are verified compatible
sets, carrying `EvmNetwork`, `EVM_NETWORKS`, the injected EVM RPC, `createExtensionTest`,
`createMetamaskTest` and the reporting API. `metamask@0.2.0` also ships its own pinned extension, so
a consuming project needs no extension download step.

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
  repository script that the package does not ship. (From `metamask@0.2.0` that fixture also reads
  `.env.wallet-e2e.local` / `.env.local` from your working directory — still not a consumer API.)
- Both drivers' `importWallet` verifies the unlocked account against an expected address, so your
  own seed needs its matching address too: `WALLETS_E2E_ETH_ADDRESS` for MetaMask,
  `WALLETS_E2E_MAINNET_ADDRESS` and `WALLETS_E2E_TESTNET_ADDRESS` for Leather. Supplying the seed
  alone surfaces as an address mismatch rather than a missing-configuration error.

### Published package commands

```bash
# Leather (Stacks)
pnpm add -D @wallets-e2e/core@0.1.7 @wallets-e2e/leather@0.1.4 @playwright/test

# MetaMask (EVM)
pnpm add -D @wallets-e2e/core@0.1.7 @wallets-e2e/metamask@0.2.0 @playwright/test
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

For MetaMask, use `createMetamaskTest`: it is `createExtensionTest` with the extension already
resolved. `@wallets-e2e/metamask` ships its own pinned 13.13.1 build and downloads it on first use
when an install skipped its `postinstall`, so the project needs no extension path and no download
script of its own.

```ts
// tests/fixtures.ts
import { createMetamaskTest } from '@wallets-e2e/metamask';

export const test = createMetamaskTest({
  profilePrefix: 'my-dapp-wallet',
  // Prefer throw in CI. Use skip locally only when an absent extension is intentionally optional.
  onMissingExtension: process.env.CI ? 'throw' : 'skip',
});

export { expect } from '@playwright/test';
```

For Leather, or for a build of your own, name the directory holding `manifest.json` yourself:

```ts
// tests/fixtures.ts
import { resolve } from 'node:path';
import { createExtensionTest } from '@wallets-e2e/core';

export const test = createExtensionTest({
  extensionPath: resolve('.wallet-extensions/leather/dist'),
  profilePrefix: 'my-dapp-wallet',
  extensionName: 'Leather',
  // This text is shown on a missing build; it is not executed by createExtensionTest.
  buildCommand: 'pnpm build:leather',
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

Combined recording is pending publication. Package consumption of this feature is blocked until
a compatible core release containing it is published. Do not promise it from an earlier release.
In that release, `createExtensionTest` defaults to `artifacts.videoLayout: 'combined'`: one `video`
attachment follows app → wallet → app on a shared timeline, including repeated approvals and
interactions in iframes. Blank and invisible extension worker pages are excluded. Install FFmpeg
with the `libvpx` encoder on PATH in the consumer's workstation and CI, or select an executable
through `artifacts.ffmpegPath`. Page start times are estimated; the video captures browser
viewports without desktop chrome or audio. After approving a manually retained wallet tab, call
the public Playwright `page.bringToFront()` on the app page to resume its view.

`artifacts.videoLayout: 'separate'` keeps individual page recordings. The fixture also falls back
to this behavior, with a warning, if activity tracking or FFmpeg composition fails. The primary
attachment is `video`, followed by `video-wallet-approval`, `video-wallet`, or `video-page`, with
numbered suffixes for repeats. The idle wallet home recording is dropped unless it is the only
recording or `artifacts.walletHomeVideo: true` was requested. That option affects separate mode
only. Earlier published core releases use separate videos without the new layout options.
Successful composition deletes intermediate page videos; failure-only retention deletes passing
recordings. The wallet's visible home screenshot is kept independently of video layout.

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
