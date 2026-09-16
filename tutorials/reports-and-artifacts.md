# Reports and artifacts: following the app and wallet in one video

`createExtensionTest` records a chronological video that switches from your app to the wallet
approval window and returns when that window closes. A second approval appears later in the same
video. Screenshots show the visible pages at the end of the test, and unexpected failures retain
a Playwright trace.

**Release status:** combined recording and its `videoLayout` / `ffmpegPath` options are pending
publication. Package consumption of this feature is blocked until a core release containing it is
published with compatible wallet adapters. Earlier core releases produce separate page videos.
The examples below describe the public API of the upcoming release.

## Install and prepare the wallet

Install the published packages in your application, choosing the adapter for your wallet:

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/metamask @playwright/test
npx playwright install chromium
```

For Leather, install `@wallets-e2e/leather` instead of the MetaMask adapter. Wallet browser artifacts
are separate downloads. Follow the [MetaMask package guide](../wallets/metamask/README.md) for its
pinned official release and SHA-256 verification, or the
[Leather package guide](../wallets/leather/README.md) for its pinned acquisition method. Store the
unpacked extension in a caller-owned, gitignored directory such as
`.wallet-extensions/metamask-13.13.1`.

Install an FFmpeg executable with the `libvpx` encoder on your workstation and CI runner. By
default the fixture runs `ffmpeg` from `PATH`; `artifacts.ffmpegPath` can select another executable.
FFmpeg combines Playwright's page recordings after the browser context closes.

## Configure reporting

```ts
// playwright.config.ts in your application
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

export default withWalletReporting(defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 120_000,
}));
```

```ts
// tests/fixtures.ts in your application
import { resolve } from 'node:path';
import { createExtensionTest } from '@wallets-e2e/core';

export const test = createExtensionTest({
  extensionPath: resolve('.wallet-extensions/metamask-13.13.1'),
  extensionName: 'MetaMask',
  artifacts: { videoLayout: 'combined' }, // default
});

export { expect } from '@playwright/test';
```

Tests and wallet drivers use the same `context` and `page` fixtures. Use
`metamaskDriver` from `@wallets-e2e/metamask` or `leatherDriver` from `@wallets-e2e/leather` for wallet
actions. Existing adapter test fixtures that use `createExtensionTest` inherit combined recording
when their installed core version contains this feature. Pass `base: bddTest` when extending the
`test` exported by `playwright-bdd`.

```bash
npx playwright test
npx playwright show-report playwright-report
```

## What the video shows

The report attaches one WebM video under the name `video`. New visual pages, focus changes, and
trusted pointer, keyboard, and input events choose the page shown on the timeline, including
interactions within iframes. Closing an approval window restores the previously active page.
An idle wallet home tab does not continually replace the app. Blank and invisible extension worker
pages are excluded.

This is a composition of browser page viewports, without desktop chrome or audio. Sources are
scaled proportionally and centered within a 1280 × 720 canvas at 25 frames per second. The shared
clock preserves elapsed time during loading and approvals; each segment starts at its activity
offset in the page's video. Page-video offsets are estimated from page registration time, so
switches can differ slightly from the original rendering time.

If you manually leave an approval tab open, bring the app to the foreground after finishing:

```ts
await page.bringToFront();
```

MetaMask's driver also restores app focus after an approval clears in a notification tab that
stays open. Other adapters can use the same public Playwright call for such surfaces.

If FFmpeg is unavailable or composition fails, the fixture warns and attaches the separate page
recordings. The test's result remains unchanged. To always keep separate recordings, use
`artifacts: { videoLayout: 'separate' }`. In that mode `walletHomeVideo: true` also retains the
wallet's idle home recording. Successful composition removes the intermediate page videos.

## Retention and screenshots

| Setting | Default | Meaning |
|---|---|---|
| `use.video` | `'on'` | Record and retain video for every result. |
| `use.screenshot` | `'on'` | The fixture captures visible pages at test end. |
| `use.trace` | `'retain-on-failure'` | Playwright retains traces for unexpected failures. |

`artifacts.video` overrides `use.video`; `artifacts.screenshot` overrides `use.screenshot`.
Otherwise each uses the package default. Both accept `'on'`, `'off'`, `'only-on-failure'`, and
`'retain-on-failure'`. Video retry modes are treated as `'retain-on-failure'`.
An expected failure from `test.fail()` is not an unexpected failure worth retaining.

`withWalletReporting` preserves your reporter and explicit modes. It parks `use.screenshot`
under the fixture's own setting and disables Playwright's automatic screenshots, letting the
fixture exclude invisible pages. Screenshots are named `screenshot`, `screenshot-wallet`, and
`screenshot-wallet-approval`; approval stills are included for failed tests. Trace remains entirely
Playwright's and is configured through `use.trace`.

## CI artifacts

Install FFmpeg in CI and upload both `playwright-report/` and `test-results/` even when tests fail.
Open the primary `video` to find when the failure occurred, then inspect the trace at that moment:

```bash
npx playwright show-trace test-results/your-test-directory/trace.zip
```

The browser profile is temporary and removed after each test. Video-off mode creates no videos;
failure-only mode deletes passing recordings. For collection diagnostics, set `WALLETS_E2E_DEBUG=1`.
