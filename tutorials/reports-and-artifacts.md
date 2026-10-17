# Reports and artifacts: the video, the screenshots and the evidence site

`createExtensionTest` records every test, screenshots the visible pages at its end, keeps the
pages' console errors when it fails, and leaves Playwright's trace for unexpected failures. The
`@wallets-e2e/evidence` CLI turns the JSON report of a run into one static page a reviewer can open
or a team can deploy.

## Install and prepare the wallet

Install the published packages in your application, choosing the adapter for your wallet:

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/metamask @playwright/test
npx playwright install chromium
```

For Leather, install `@wallets-e2e/leather` instead of the MetaMask adapter. Wallet browser artifacts
are separate downloads. Follow the [MetaMask package guide](../wallets/metamask/README.md) for its
pinned official release and SHA-256 verification, or the
[Leather package guide](../wallets/leather/README.md) for its pinned acquisition method.

Install FFmpeg with the `libx264` encoder on your workstation and CI runner (`libvpx` as well if
you choose `videoSource: 'chromium'`). The fixture runs `ffmpeg` from `PATH`; `artifacts.ffmpegPath`
selects another executable.

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
import { createMetamaskTest } from '@wallets-e2e/metamask';

export const test = createMetamaskTest({
  artifacts: {
    videoSource: 'screenshots', // the default; 'chromium' keeps Playwright's recorder
    videoScope: 'app',          // the app only; 'all' (default) also shows the wallet's approval pages
  },
});

export { expect } from '@playwright/test';
```

```bash
npx playwright test
npx playwright show-report playwright-report
```

## Why the video is built from screenshots

Chromium's `recordVideo` films the compositor surface of a page, not the page. A wallet driver
reaches an approval by opening it as a second tab of the same window (`context.newPage()` and a
`goto` of the extension's `notification.html`, which is how MetaMask approvals are found). After
that first tab, the app page's recorded surface no longer covers its viewport: every later frame
holds the top-left ~80% of the page with flat background beside it, and the right edge of each
screen is gone. The page itself is fine — `Page.getLayoutMetrics`, `Browser.getWindowBounds` and
`window.innerWidth` all keep reporting the full 1280×720 — and neither resizing the window nor
re-applying the viewport brings the surface back. The per-page recordings are already cropped
before any composition.

`page.screenshot()` goes through CDP and is always the whole viewport. So by default the fixture
takes one every 200 ms of the page in use and, when the context has closed, encodes them with
real per-frame timing into an H.264 mp4 attached as `video`. The result is one recording of what
the test did, at the page's full size, that every browser and report can play.

`artifacts.screenshotVideo` tunes it: `intervalMs` (200), `quality` (JPEG, 90), `fps` (25), `crf`
(20), `tailMs` (how long the last frame is held, 1500). Raise `intervalMs` on pages that are slow
to paint. Without FFmpeg the fixture warns once and falls back to Chromium's recorder, so a run
still has footage.

### Chromium's recorder

`videoSource: 'chromium'` keeps Playwright's per-page WebM recordings and composes them on an
activity timeline: new visual pages, focus changes and trusted pointer, keyboard and input events
choose the page shown, closing an approval window restores the previous page, and the idle wallet
home tab never replaces the app. `videoLayout: 'separate'` keeps the individual recordings instead
(`walletHomeVideo: true` adds the wallet's home page), and composition failures fall back to them
with a warning. This path is where the crop above appears.

## Retention, screenshots and page logs

| Setting | Default | Meaning |
|---|---|---|
| `use.video` | `'on'` | Record and retain video for every result. |
| `use.screenshot` | `'on'` | The fixture captures visible pages at test end. |
| `use.trace` | `'retain-on-failure'` | Playwright retains traces for unexpected failures. |
| `artifacts.pageLogs` | `'retain-on-failure'` | Console errors and warnings and uncaught errors of every page, attached as `page-logs`. |

`artifacts.video` overrides `use.video`; `artifacts.screenshot` overrides `use.screenshot`. Both
accept `'on'`, `'off'`, `'only-on-failure'` and `'retain-on-failure'`; video retry modes are
treated as `'retain-on-failure'`. An expected failure from `test.fail()` is not retained. A video
that is not retained is never encoded: the frames are deleted when the test ends.

`withWalletReporting` preserves your reporter and explicit modes. It parks `use.screenshot` under
the fixture's own setting and disables Playwright's automatic screenshots, letting the fixture
exclude invisible pages. Screenshots are named `screenshot`, `screenshot-wallet` and
`screenshot-wallet-approval`; approval stills are included for failed tests. `WALLETS_E2E_DEBUG=1`
echoes every console message as it happens and reports artifact collection problems.

## Settling a write

A wallet test must prove a write landed, not that the popup closed. `settleWrite` does the three
steps every write needs: read the transaction hash from the app, wait for its receipt and refuse a
revert, then keep asserting the resulting state until the app and its RPC have caught up.

```ts
import { createInjectedEvmRpc, createTxProbe, settleWrite, sponsoredUserOperation } from '@wallets-e2e/core';

const probe = createTxProbe(page, { testId: 'last-tx', eventPrefix: 'my-app' });
await probe.clear();
await metamaskDriver.confirmTransaction(context, () => page.getByRole('button', { name: 'Mint' }).click());
await settleWrite({
  probe,
  rpc: createInjectedEvmRpc(page),
  verifyReceipt: sponsoredUserOperation({ attach: test.info() }), // ERC-4337 only
  assertState: async () => expect(await balanceOf(holder)).toBe(10n),
});
```

The app's side of that is the **transaction probe**, a contract any framework implements in a few
lines: an element `<div data-testid="last-tx" data-status data-hash data-user-op-hash data-operator
data-sponsored data-error aria-hidden>` updated on every transition of the latest write
(`idle` → `pending` → `submitted` → `confirmed` or `failed`), a `window` event
`<prefix>:transaction` whose `detail` is that state, dispatched on every transition, and a listener
for `<prefix>:clear-last-tx` that returns the element to `idle`. `probe.captureAll()` records every
event in Node, so a flow of several chained writes can be followed even though the element only
shows the last one; `probe.waitForCaptured(n)` is the n-th settled write.

`assertSponsoredUserOperation` reads the ERC-4337 `UserOperationEvent` out of the receipt
(EntryPoint v0.9 by default) and checks that exactly one matches the operation, that it succeeded,
that the operator sent it and that a paymaster paid; it attaches `confirmed-aa-transaction` so
reports and the evidence site can link the transaction.

## The evidence site

```bash
npx wallets-e2e-evidence \
  --report test-results/report.json \
  --out evidence \
  --test-results test-results \
  --explorer-tx-url https://sepolia.basescan.org/tx/ \
  --full-flow lifecycle.spec.ts \
  --netlify
```

One `index.html` with the totals, then every spec and test: status, duration, the `video`, the
screenshots and a table linking every transaction the test attached. `--full-flow` joins one
spec's videos, in run order, into a single recording. Several `--report` files merge, a later
report replacing an earlier result for the same test, so a rerun of one failed spec slots into the
suite's evidence. `--netlify` adds `_headers` and `netlify.toml`, so `netlify deploy --dir evidence`
publishes the folder as it is. Point Playwright's JSON reporter at a file with
`PLAYWRIGHT_JSON_OUTPUT_NAME` (`--reporter=list,html,json`); the MCP's `get_report` builds the same
site with `evidence: true`.

## CI artifacts

Install FFmpeg in CI and upload both `playwright-report/` and `test-results/` even when tests fail.
Open the `video` to find when the failure occurred, then inspect the trace at that moment:

```bash
npx playwright show-trace test-results/your-test-directory/trace.zip
```

The browser profile is temporary and removed after each test.
