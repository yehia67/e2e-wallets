# Test Reporting & Artifacts for `@wallets-e2e/core`

**Date:** 2026-08-30
**Status:** Approved for implementation
**Scope:** `packages/core`, all five packages under `examples/`, `tutorials/`, root and core READMEs.

## Problem

Playwright ships video, screenshot, trace and HTML-report machinery, and this repo currently gets
almost none of it.

Every wallet test runs against a context created by `packages/core#launchContext`, which calls
`chromium.launchPersistentContext` — the only way to load an unpacked browser extension (AD-1).
Playwright's artifact machinery is wired to the contexts *it* creates through the built-in
`browser`/`context` fixtures. A hand-launched persistent context is invisible to it. Consequences
observed in the repo today:

1. **Videos are orphans.** `launchContext` passes `recordVideoDir`, so `.webm` files are written —
   but to a single shared directory, named `page@<hash>.webm`, with no link to the test that
   produced them and no entry in any report. `examples/bdd/test-results/videos/` currently holds
   eleven such files from unknown runs.
2. **Screenshot-on-failure does not happen at all.** No example sets `use.screenshot`, and even if
   one did, the automatic capture would not fire for a persistent context.
3. **No HTML report.** All five example configs use `reporter: [['list']]`. There is no
   `playwright-report/`, so there is no artifact-carrying report to open after a run.
4. **No traces.** Never started, never attached.
5. **Fixture boilerplate is duplicated five times.** Each example re-implements the same
   ~30 lines: check `manifest.json` exists, `mkdtempSync` a profile, `launchContext`, `use`,
   `close`, `rmSync`. Two of the five omit the `rmSync`, leaking Chromium profiles.

The wallet-specific opportunity: at failure time the persistent context holds the dapp page *and*
the wallet's own extension pages (popup, notification window, onboarding tab). Screenshotting all
of them is exactly the debugging information a wallet-E2E user needs, and it is something stock
Playwright cannot produce for this setup at all.

## Goals

- Every artifact Playwright can produce is produced for wallet tests and is reachable from an HTML
  report: video, failure screenshots (dapp **and** wallet pages), trace.
- Users configure artifacts the ordinary Playwright way — `use.video` / `use.screenshot` /
  `use.trace` in `playwright.config.ts` — not through a bespoke vocabulary.
- Example fixture files shrink to a declaration of *which extension*, nothing else.
- Existing consumers of `launchContext` keep working unchanged.

## Non-goals

- Custom reporters or a bespoke report UI. Playwright's HTML reporter is the deliverable.
- Headless support beyond what exists today (v1 remains headed, AD-6).
- Artifact upload, retention policies across runs, or CI integration.
- Changing `@wallets-e2e/core/bdd`'s step vocabulary.

## Architecture

### Module boundary

New file `packages/core/src/reporting.ts`, re-exported from `src/index.ts`. `index.ts` is already
~700 lines carrying context launch, the `WalletDriver` port, network presets, RPC probing and two
chains' mining helpers; reporting does not go in there. No other restructuring is in scope.

Pure, browser-free logic lives in `reporting.ts` as exported functions so `node --test` can cover
it without a Playwright runner — the same split `src/bdd/guards.ts` already uses.

### Public surface

```ts
export type ArtifactMode = 'on' | 'off' | 'only-on-failure' | 'retain-on-failure';

export interface WalletArtifactOptions {
  video?: ArtifactMode;
  screenshot?: ArtifactMode;
  trace?: ArtifactMode;
}

export interface CreateExtensionTestOptions<TBase> {
  /** Absolute path to the unpacked extension build (the `manifest.json` parent). */
  extensionPath: string;
  /** Test object to extend. Defaults to `@playwright/test`'s `test`. */
  base?: TBase;
  /** Prefix for the per-test temp profile directory. Defaults to `'wallets-e2e'`. */
  profilePrefix?: string;
  /** Runs headed unless overridden, matching `launchContext`. */
  headless?: boolean;
  /** Per-artifact override. Anything omitted falls back to the project's `use` block. */
  artifacts?: WalletArtifactOptions;
  /** Human-readable name used in the "extension is not built" error. Defaults to the dir name. */
  extensionName?: string;
}

export function createExtensionTest<TBase>(options: CreateExtensionTestOptions<TBase>): TBase;

export function withWalletReporting(config: PlaywrightTestConfig): PlaywrightTestConfig;
```

`@playwright/test` is already a peer dependency; `PlaywrightTestConfig` is a type-only import.

### `createExtensionTest`

Returns `options.base.extend({...})` with three fixtures:

| Fixture | Value | Why it exists |
| --- | --- | --- |
| `context` | the persistent extension context | Overriding the built-in name is what makes `@wallets-e2e/core/bdd`'s steps — which read stock `context`/`page` — work against an extension context without knowing anything about extensions. |
| `page` | `context.newPage()` | The dapp's own tab, so a step's `page` is unambiguous while the wallet's own pages live in the same context. |
| `extensionContext` | alias of `context` | `examples/spike`, `examples/react-connect` and `examples/metamask-spike` tests already destructure this name. Aliasing keeps every existing test body compiling untouched. |

The override does not request the built-in `browser` fixture, so no second browser is launched.

Before launching, the fixture asserts `join(extensionPath, 'manifest.json')` exists and throws
naming the extension and the build command — the check all five examples hand-roll today.

The same factory serves plain and BDD examples: BDD ones pass `base: test` imported from
`playwright-bdd`. `TBase` is generic so the returned object keeps that base's own fixture types.

### Artifact lifecycle

Order is load-bearing. Trace and screenshots need a live context; video only flushes on close.

1. **Before `use`** — if trace is enabled, `context.tracing.start({ screenshots: true, snapshots:
   true, sources: true })`.
2. **`await use(context)`**.
3. **Failure screenshots**, context still alive. If screenshot mode says capture, iterate
   `context.pages()`, skipping closed ones, and screenshot each. Attachment names derive from the
   page URL: `screenshot-dapp-<host>` for `http(s)://`, `screenshot-wallet-<last-path-segment>`
   for `chrome-extension://`. Every capture is individually wrapped in `try/catch`: a crashed or
   navigating page must never replace the test's real failure with an artifact error.
4. **`context.tracing.stop({ path: testInfo.outputPath('trace.zip') })`** when retaining, plain
   `stop()` otherwise. Attached under the exact name `trace` — Playwright's HTML reporter
   special-cases that name and renders a "view trace" link.
5. **`context.close()`**.
6. **Videos.** Pages are tracked during the run via `context.on('page')` plus whatever
   `context.pages()` held at launch, recording each page's URL before close so names stay
   meaningful. After close, `await video.path()` resolves for each. Popup windows that escaped the
   event listener are caught by a directory scan of the video dir for `.webm` files not already
   attached. Retained videos are attached (`video`, then `video-2`, `video-3`, …); discarded ones
   are deleted.
7. **`rmSync(userDataDir, { recursive: true, force: true })`** in a `finally`, so a failed launch
   still cleans up its profile.

`recordVideoDir` is `testInfo.outputPath('videos')` — a per-test directory. This alone fixes the
shared-directory `page@<hash>.webm` collision that makes today's videos unattributable.

Steps 3, 4 and 6 each run inside their own `try/catch`. Artifact collection never fails a test.

### Mode resolution

```
explicit `artifacts.<kind>`  →  testInfo.project.use.<kind>  →  built-in default
```

Built-in defaults: `video: 'on'`, `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`.
These match `withWalletReporting`'s injected `use` block, so a config that uses the wrapper and a
config that does not behave identically.

Playwright's `use.video` and `use.trace` also accept object forms (`{ mode, size }`); the resolver
reads `.mode` off an object and the string otherwise. `'retain-on-failure'` and `'only-on-failure'`
are treated as the same predicate — retain iff `testInfo.status !== testInfo.expectedStatus` — so
either spelling works for any artifact kind.

### `withWalletReporting`

```ts
export default withWalletReporting(defineConfig({
  testDir: './tests',
  use: { channel: 'chromium', baseURL: 'http://localhost:5173' },
}));
```

Merges, without overwriting anything the caller set:

- `reporter` → `[['list'], ['html', { open: 'never' }]]`, only when the caller left `reporter`
  unset. A caller who supplied their own reporter list keeps it verbatim.
- `use.video`, `use.screenshot`, `use.trace` → the defaults above, each only if that key is absent.

Every other config key passes through untouched. The wrapper is a plain function over the config
object, so it is unit-testable with no runner involved.

### Back-compat

`LaunchContextOptions.recordVideoDir` becomes optional. Omitting it launches with no
`recordVideo`. All current callers pass it and are unaffected. `launchContext` keeps its signature
and its AD-1 role as the single `launchPersistentContext` call in the monorepo —
`createExtensionTest` is built on it, not beside it.

`packages/core` version: `0.1.3` → `0.2.0`.

## Testing

`node --test`, matching `src/bdd/*.test.ts` (explicit `.ts` import extensions, excluded from the
package build via the existing `files`/tsconfig exclusions):

`packages/core/src/reporting.test.ts`

- `resolveArtifactMode` — explicit option wins over project `use`; project `use` wins over the
  default; object form `{ mode: 'retain-on-failure' }` resolves to its `.mode`; an unset chain
  falls through to the documented default.
- `shouldRetainArtifact(mode, status, expectedStatus)` — `'on'` always retains; `'off'` never
  does; `'only-on-failure'` and `'retain-on-failure'` retain iff status differs from expected;
  a test that expected to fail and did fail is a pass and retains nothing.
- `attachmentNameForPageUrl` — an `http(s)` dapp URL yields `screenshot-dapp-<host>`; a
  `chrome-extension://<id>/home.html#/confirm` yields a wallet-scoped name that does not embed the
  volatile extension id; a malformed or `about:blank` URL yields a stable fallback rather than
  throwing.
- `withWalletReporting` — injects reporter and the three `use` keys into a bare config; leaves a
  caller-supplied `reporter` untouched; leaves a caller-supplied `use.video` untouched while still
  filling in the other two; preserves unrelated keys (`testDir`, `webServer`, `timeout`).

The fixture's own browser-level behaviour is covered by the five example suites, which exercise it
on every run. No new browser-level test package is added.

## Files changed

**Created**

- `packages/core/src/reporting.ts`
- `packages/core/src/reporting.test.ts`
- `tutorials/reports-and-artifacts.md`

**Modified**

- `packages/core/src/index.ts` — re-export `./reporting.js`; make `recordVideoDir` optional.
- `packages/core/package.json` — version `0.2.0`.
- `packages/core/README.md` — reporting section, link to the tutorial.
- `README.md` (root) — link the new tutorial alongside `quick-start.md` and `feature-files.md`.
- `examples/spike/tests/fixtures.ts` *(and its config)*
- `examples/react-connect/tests/fixtures.ts` *(and its config)*
- `examples/metamask-spike/tests/fixtures.ts` *(and its config)*
- `examples/bdd/steps/fixtures.ts` *(and its config)*
- `examples/metamask-bdd/steps/fixtures.ts` *(and its config)*

Each example fixture keeps only its `EXTENSION_PATH` and its wallet-specific wiring
(`createWalletSteps` for the BDD pair); the context/profile/artifact body is deleted in favour of
`createExtensionTest`. Each example config is wrapped in `withWalletReporting` and drops its now
redundant `reporter` and `use.video` lines.

`.gitignore` already covers `test-results/`, `playwright-report/` and `blob-report/`; no change
needed. The eleven stale `.webm` files checked into `examples/bdd/test-results/videos/` are
deleted — they are untracked build residue that the ignore rules already exclude.

## Tutorial

`tutorials/reports-and-artifacts.md`, written to match the existing two tutorials' voice:

1. What you get — one HTML report per run carrying video, failure screenshots of *both* the dapp
   and the wallet popup, and a trace.
2. Wiring it up — `withWalletReporting` around your config, `createExtensionTest` in your fixture,
   with the before/after diff of an example.
3. Running and opening — `pnpm test`, then `pnpm exec playwright show-report`.
4. Reading a failure — which artifact answers which question; opening `trace.zip` in
   `show-trace`/trace.playwright.dev.
5. Tuning — the `use.video`/`use.screenshot`/`use.trace` modes, `artifacts` per-fixture override,
   and where the raw files land under `test-results/<test-id>/`.
6. CI note — `playwright-report/` and `test-results/` are gitignored; upload them as CI artifacts.

## Risks

- **Overriding the built-in `context` fixture.** Playwright's own `page` fixture and its artifact
  machinery are built on the context it creates. Overriding it is already what all five examples
  do today, so this is the status quo rather than a new risk — and it is precisely why the
  artifact work in this design has to be done by hand.
- **Video path resolution after close.** `video.path()` resolving post-`context.close()` is the
  documented contract, but popup windows are the fragile case. The directory-scan fallback exists
  for exactly that, and the whole step is non-fatal.
- **Trace size.** `retain-on-failure` keeps traces off the happy path; a failing wallet run can
  still produce a multi-MB `trace.zip`. Documented in the tutorial's CI note.
