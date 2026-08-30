# Test Reporting & Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Playwright artifact — video, failure screenshots of both the dapp and the wallet's own popup pages, and traces — attach to the test that produced it and show up in an HTML report, for tests that run against a hand-launched extension context.

**Architecture:** `packages/core` gains a `reporting/` module. Pure, browser-free logic (mode resolution, retention predicate, attachment naming, config merge) lives in `reporting/artifacts.ts` and is unit-tested by `node --test`; the Playwright-dependent fixture factory lives in `reporting/index.ts`. `launchContext` moves to its own `src/context.ts` so `reporting/` can import it without an `index.ts` import cycle. Examples stop hand-rolling fixtures and call `createExtensionTest`.

**Tech Stack:** TypeScript 5.6 (ESM, `NodeNext`), `@playwright/test` ^1.47 (peer), `playwright-bdd` ^9.2 (optional peer), pnpm 9.11 workspaces + turbo, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-30-reporting-artifacts-design.md`

## Global Constraints

- Node `>=22.18`. Package manager `pnpm@9.11.0`. Run workspace commands as `pnpm --filter <pkg> <script>`.
- All packages are `"type": "module"`. **Source imports inside `packages/core/src` use explicit `.js` extensions** (`./context.js`), because the build emits real ESM. **Test files import with explicit `.ts` extensions** (`./artifacts.ts`) because `node --test` runs them straight from source — this is the existing convention in `src/bdd/guards.test.ts`.
- `*.test.ts` files are excluded from the published build by `packages/core/tsconfig.build.json` (`"exclude": ["src/**/*.test.ts"]`) and from the tarball by `package.json`'s `"files": ["dist", "src", "!src/**/*.test.ts"]`. Do not change either.
- **AD-1: `chromium.launchPersistentContext` is called in exactly one place in this monorepo.** After Task 1 that place is `packages/core/src/context.ts`. `reporting/` calls `launchContext`, never Chromium directly.
- **NFR2:** `channel: 'chromium'` always — never branded Chrome or Edge.
- **AD-6:** v1 is headed. `headless` stays an opt-in passthrough; do not change the default.
- `@playwright/test` is a **peer** dependency of `@wallets-e2e/core`. Import types from it freely; import *values* from it only in `reporting/index.ts` (never in a file `node --test` loads).
- Never commit a real-value seed phrase. The checked-in Leather fixture seed is a deliberate zero-value default; leave it alone.
- Do not push to any remote. Local commits only.

---

### Task 1: Extract `launchContext` into its own module and make video recording optional

`packages/core/src/index.ts` is ~700 lines and `reporting/` needs `launchContext`. Importing it from `index.js` while `index.ts` re-exports `reporting/` would create an ESM import cycle. Moving the context code into its own file removes the cycle and is a pure code move — no behavior change except `recordVideoDir` becoming optional.

**Files:**
- Create: `packages/core/src/context.ts`
- Modify: `packages/core/src/index.ts` (delete the moved block, add a re-export)
- Test: `packages/core/src/context.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `LaunchContextOptions { extensionPath: string; userDataDir?: string; recordVideoDir?: string; headless?: boolean }` — note `recordVideoDir` is now **optional**.
  - `launchContext(options: LaunchContextOptions): Promise<BrowserContext>`
  - `resolveExtensionId(context: BrowserContext): Promise<string>`
  - Both remain exported from `@wallets-e2e/core` root, unchanged for consumers.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/context.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: this file is run by `node --test` straight from source and is
// excluded from the package build.
import { launchContext } from './context.ts';

describe('launchContext', () => {
  it('rejects with a build hint when the extension directory does not exist', async () => {
    await assert.rejects(
      () => launchContext({ extensionPath: '/definitely/not/a/real/extension' }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Extension not found/);
        assert.match(error.message, /packages\/core/);
        return true;
      },
    );
  });

  it('does not require recordVideoDir to reach the extension check', async () => {
    // The point of the assertion: omitting `recordVideoDir` must be a legal call. If it were
    // still required this would not compile, and the rejection we get must be the extension
    // check — not a "cannot read property of undefined" from the video options.
    await assert.rejects(
      () => launchContext({ extensionPath: '/definitely/not/a/real/extension' }),
      /Extension not found/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wallets-e2e/core test`
Expected: FAIL — `Cannot find module './context.ts'`.

- [ ] **Step 3: Create `packages/core/src/context.ts`**

Move the code verbatim out of `src/index.ts` — the `LaunchContextOptions` interface, `launchContext`, and `resolveExtensionId`, **including their full doc comments**. The only edits are the two marked below.

```ts
import { existsSync } from 'node:fs';
import { chromium, type BrowserContext } from '@playwright/test';

/**
 * Options for launching the single, shared persistent browser context that every
 * wallet-driving test run is built on.
 *
 * AD-1: `packages/core` owns the single `chromium.launchPersistentContext` call —
 * no other package in this monorepo is allowed to call it directly.
 */
export interface LaunchContextOptions {
  /** Absolute path to the unpacked, built extension directory (its `manifest.json` parent). */
  extensionPath: string;
  /** Directory Chromium uses for its persistent profile. Defaults to a fresh temp dir if omitted. */
  userDataDir?: string;
  /**
   * Directory Playwright writes recorded video(s) into. Optional: omit it and the context records
   * nothing. `createExtensionTest` sets this per test so videos land in that test's own output
   * directory instead of one shared folder full of unattributable `page@<hash>.webm` files.
   */
  recordVideoDir?: string;
  /** Runs headed unless explicitly overridden. v1 is scoped to headed execution (AD-6). */
  headless?: boolean;
}

/**
 * Launches the one persistent Chromium context every test in this monorepo runs against, with
 * the target extension pre-loaded and video recording enabled when a directory is given.
 *
 * Always uses `channel: 'chromium'` (Playwright's bundled Chromium) — never branded Chrome/Edge
 * (NFR2). Extensions only load via `launchPersistentContext`, never a one-off `chromium.launch`.
 */
export async function launchContext(options: LaunchContextOptions): Promise<BrowserContext> {
  const { extensionPath, userDataDir = '', recordVideoDir, headless = false } = options;

  if (!existsSync(extensionPath)) {
    throw new Error(
      `[packages/core] Extension not found at "${extensionPath}". ` +
        `Build it first (see wallets/leather/scripts/build-extension.sh) before launching a context.`,
    );
  }

  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      ...(headless ? ['--headless=new'] : []),
    ],
    ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir } } : {}),
  });
}

/**
 * Resolves the extension's runtime ID from its live background service worker — never a
 * pre-pinned manifest key (AD-4), since the ID is only stable/known once Chromium has actually
 * loaded the unpacked extension for this run.
 */
export async function resolveExtensionId(context: BrowserContext): Promise<string> {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }

  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (!match) {
    throw new Error(
      `[packages/core] Could not resolve extension ID — unexpected service worker URL: "${worker.url()}"`,
    );
  }
  return match[1];
}
```

The two edits versus the original: `recordVideoDir` is optional, and `recordVideo` is spread in conditionally so omitting the directory records nothing rather than passing `{ dir: undefined }`.

- [ ] **Step 4: Delete the moved code from `src/index.ts` and re-export instead**

In `packages/core/src/index.ts`:

1. Delete the `LaunchContextOptions` interface, `launchContext`, and `resolveExtensionId` (the block from the top-of-file `import { existsSync }` line through the end of `resolveExtensionId`).
2. Delete the now-unused `existsSync` import and drop `chromium` from the `@playwright/test` import, leaving `import type { BrowserContext, Page } from '@playwright/test';` — check whether the remaining file still uses `BrowserContext`/`Page` as values or only as types before choosing `import` vs `import type`.
3. Add at the top of the file, immediately after the remaining imports:

```ts
// `launchContext` lives in its own module so `./reporting` can import it without an import cycle
// through this file, which re-exports `./reporting` in turn.
export { launchContext, resolveExtensionId, type LaunchContextOptions } from './context.js';
```

Nothing else in `index.ts` changes. `src/bdd/*` imports `BrowserContext` and `WalletDriver` from `'../index.js'` and keeps working through the re-export.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @wallets-e2e/core test && pnpm --filter @wallets-e2e/core typecheck && pnpm --filter @wallets-e2e/core build`
Expected: all three PASS. The build must emit `dist/context.js` and `dist/context.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/context.test.ts packages/core/src/index.ts
git commit -m "refactor(core): extract launchContext into src/context.ts, make recordVideoDir optional"
```

---

### Task 2: Pure artifact helpers

Everything in this task is a pure function over plain values, with **type-only** imports from `@playwright/test`. That is what lets `node --test` cover it with no browser and no runner — the same split `src/bdd/guards.ts` already uses to stay testable without the optional `playwright-bdd` peer.

**Files:**
- Create: `packages/core/src/reporting/artifacts.ts`
- Test: `packages/core/src/reporting/artifacts.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces, all used by Task 3:
  - `type ArtifactMode = 'on' | 'off' | 'only-on-failure' | 'retain-on-failure'`
  - `interface WalletArtifactOptions { video?: ArtifactMode; screenshot?: ArtifactMode; trace?: ArtifactMode }`
  - `const DEFAULT_ARTIFACT_MODES: Required<WalletArtifactOptions>`
  - `resolveArtifactMode(explicit: ArtifactMode | undefined, fromProjectUse: unknown, fallback: ArtifactMode): ArtifactMode`
  - `shouldRetainArtifact(mode: ArtifactMode, status: string | undefined, expectedStatus: string | undefined): boolean`
  - `attachmentNameForPageUrl(url: string, index: number): string`
  - `walletReporters(options?: { outputFolder?: string; open?: 'never' | 'on-failure' | 'always' }): PlaywrightTestConfig['reporter']`
  - `withWalletReporting<T extends PlaywrightTestConfig>(config: T): T`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/reporting/artifacts.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import {
  DEFAULT_ARTIFACT_MODES,
  attachmentNameForPageUrl,
  resolveArtifactMode,
  shouldRetainArtifact,
  walletReporters,
  withWalletReporting,
} from './artifacts.ts';

describe('resolveArtifactMode', () => {
  it('prefers an explicit option over everything else', () => {
    assert.equal(resolveArtifactMode('off', 'on', 'on'), 'off');
  });

  it('falls back to the project use block when no explicit option was given', () => {
    assert.equal(resolveArtifactMode(undefined, 'off', 'on'), 'off');
  });

  it('falls back to the documented default when neither was given', () => {
    assert.equal(resolveArtifactMode(undefined, undefined, 'only-on-failure'), 'only-on-failure');
  });

  it('reads .mode off the object form Playwright allows for video and trace', () => {
    // `use: { video: { mode: 'retain-on-failure', size: { width: 800, height: 600 } } }`
    assert.equal(
      resolveArtifactMode(undefined, { mode: 'retain-on-failure' }, 'on'),
      'retain-on-failure',
    );
  });

  it('maps the retry-scoped trace modes onto retain-on-failure', () => {
    // This package cannot see Playwright's retry bookkeeping from inside a fixture, so the
    // closest honest behaviour is "keep it when the test did not pass".
    assert.equal(resolveArtifactMode(undefined, 'on-first-retry', 'on'), 'retain-on-failure');
    assert.equal(resolveArtifactMode(undefined, 'on-all-retries', 'on'), 'retain-on-failure');
  });

  it('ignores values it does not recognise rather than trusting them', () => {
    assert.equal(resolveArtifactMode(undefined, 'sometimes', 'on'), 'on');
    assert.equal(resolveArtifactMode(undefined, null, 'on'), 'on');
    assert.equal(resolveArtifactMode(undefined, 42, 'on'), 'on');
  });
});

describe('shouldRetainArtifact', () => {
  it('always retains when the mode is on', () => {
    assert.equal(shouldRetainArtifact('on', 'passed', 'passed'), true);
    assert.equal(shouldRetainArtifact('on', 'failed', 'passed'), true);
  });

  it('never retains when the mode is off', () => {
    assert.equal(shouldRetainArtifact('off', 'failed', 'passed'), false);
  });

  it('retains on failure for both spellings of the failure-scoped modes', () => {
    assert.equal(shouldRetainArtifact('only-on-failure', 'failed', 'passed'), true);
    assert.equal(shouldRetainArtifact('retain-on-failure', 'timedOut', 'passed'), true);
  });

  it('discards on success for both spellings', () => {
    assert.equal(shouldRetainArtifact('only-on-failure', 'passed', 'passed'), false);
    assert.equal(shouldRetainArtifact('retain-on-failure', 'passed', 'passed'), false);
  });

  it('treats an expected failure as a pass and retains nothing', () => {
    // test.fail() marks expectedStatus 'failed'; a test that failed as instructed did not go wrong.
    assert.equal(shouldRetainArtifact('retain-on-failure', 'failed', 'failed'), false);
  });
});

describe('attachmentNameForPageUrl', () => {
  it('names a dapp page after its host', () => {
    assert.equal(
      attachmentNameForPageUrl('http://localhost:5173/#/send', 1),
      'screenshot-dapp-localhost-5173',
    );
  });

  it('names a wallet page without embedding the volatile extension id', () => {
    const name = attachmentNameForPageUrl(
      'chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html#/confirm-transaction',
      2,
    );
    assert.match(name, /^screenshot-wallet-/);
    assert.ok(!name.includes('nkbihfbeogaeaoehlefnkodbefgpgknn'), 'extension id must not leak in');
    assert.match(name, /confirm-transaction/);
  });

  it('falls back to an indexed name for about:blank', () => {
    assert.equal(attachmentNameForPageUrl('about:blank', 3), 'screenshot-page-3');
  });

  it('falls back to an indexed name for a malformed URL instead of throwing', () => {
    assert.equal(attachmentNameForPageUrl('not a url at all', 4), 'screenshot-page-4');
  });
});

describe('walletReporters', () => {
  it('pairs the live list reporter with a non-opening HTML report', () => {
    assert.deepEqual(walletReporters(), [
      ['list'],
      ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ]);
  });

  it('honours an explicit output folder and open policy', () => {
    assert.deepEqual(walletReporters({ outputFolder: 'reports/e2e', open: 'on-failure' }), [
      ['list'],
      ['html', { outputFolder: 'reports/e2e', open: 'on-failure' }],
    ]);
  });
});

describe('withWalletReporting', () => {
  it('injects the reporter and all three artifact modes into a bare config', () => {
    const config = withWalletReporting({ testDir: './tests' });
    assert.deepEqual(config.reporter, walletReporters());
    assert.equal(config.use?.video, DEFAULT_ARTIFACT_MODES.video);
    assert.equal(config.use?.screenshot, DEFAULT_ARTIFACT_MODES.screenshot);
    assert.equal(config.use?.trace, DEFAULT_ARTIFACT_MODES.trace);
  });

  it('leaves a caller-supplied reporter completely alone', () => {
    const config = withWalletReporting({ reporter: [['junit']] });
    assert.deepEqual(config.reporter, [['junit']]);
  });

  it('leaves a caller-supplied artifact mode alone while filling in the others', () => {
    const config = withWalletReporting({ use: { video: 'off' } });
    assert.equal(config.use?.video, 'off');
    assert.equal(config.use?.screenshot, DEFAULT_ARTIFACT_MODES.screenshot);
    assert.equal(config.use?.trace, DEFAULT_ARTIFACT_MODES.trace);
  });

  it('preserves every unrelated key and the rest of the use block', () => {
    const config = withWalletReporting({
      testDir: './tests',
      timeout: 120_000,
      workers: 1,
      use: { channel: 'chromium', baseURL: 'http://localhost:5173' },
    });
    assert.equal(config.testDir, './tests');
    assert.equal(config.timeout, 120_000);
    assert.equal(config.workers, 1);
    assert.equal(config.use?.channel, 'chromium');
    assert.equal(config.use?.baseURL, 'http://localhost:5173');
  });

  it('does not mutate the config object it was handed', () => {
    const original = { testDir: './tests', use: { channel: 'chromium' } };
    withWalletReporting(original);
    assert.deepEqual(original, { testDir: './tests', use: { channel: 'chromium' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wallets-e2e/core test`
Expected: FAIL — `Cannot find module './artifacts.ts'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/reporting/artifacts.ts`:

```ts
// Type-only import, deliberately: this module is loaded by `node --test`, and pulling
// @playwright/test in as a *value* would drag the whole runner into a unit-test process.
import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * How long an artifact is kept. Playwright spells the same "keep it when the test went wrong"
 * predicate `only-on-failure` for screenshots and `retain-on-failure` for video and traces; both
 * are accepted here for any artifact kind so a config reads the way its author expects.
 */
export type ArtifactMode = 'on' | 'off' | 'only-on-failure' | 'retain-on-failure';

/** Per-artifact override for `createExtensionTest`. Anything omitted falls back to the project's `use`. */
export interface WalletArtifactOptions {
  video?: ArtifactMode;
  screenshot?: ArtifactMode;
  trace?: ArtifactMode;
}

/**
 * What you get when neither `createExtensionTest({ artifacts })` nor the project's `use` block
 * says otherwise. Identical to what `withWalletReporting` injects, so a project that uses the
 * wrapper and one that does not behave the same.
 */
export const DEFAULT_ARTIFACT_MODES = {
  video: 'on',
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
} as const satisfies Required<WalletArtifactOptions>;

/**
 * Normalises whatever a config put in `use.video` / `use.screenshot` / `use.trace`. Playwright
 * accepts a bare string or an object with a `mode` (`{ mode: 'on', size: {...} }`), and its trace
 * option has two retry-scoped modes this package cannot honour precisely — a fixture cannot see
 * the runner's retry bookkeeping — so those collapse to `retain-on-failure`, the closest honest
 * behaviour. Anything unrecognised returns `undefined` so the caller falls through rather than
 * trusting a value it does not understand.
 */
function normalizeArtifactMode(value: unknown): ArtifactMode | undefined {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null
        ? (value as { mode?: unknown }).mode
        : undefined;
  if (typeof raw !== 'string') return undefined;

  switch (raw) {
    case 'on':
    case 'off':
    case 'only-on-failure':
    case 'retain-on-failure':
      return raw;
    case 'on-first-retry':
    case 'on-all-retries':
      return 'retain-on-failure';
    default:
      return undefined;
  }
}

/** Explicit fixture option wins, then the project's `use` block, then the built-in default. */
export function resolveArtifactMode(
  explicit: ArtifactMode | undefined,
  fromProjectUse: unknown,
  fallback: ArtifactMode,
): ArtifactMode {
  return normalizeArtifactMode(explicit) ?? normalizeArtifactMode(fromProjectUse) ?? fallback;
}

/**
 * Whether an artifact survives this test. Compares against `expectedStatus`, not the literal
 * string `'passed'`: a `test.fail()`-marked test that failed did exactly what it was told to and
 * is not a failure worth an artifact.
 */
export function shouldRetainArtifact(
  mode: ArtifactMode,
  status: string | undefined,
  expectedStatus: string | undefined,
): boolean {
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return status !== expectedStatus;
}

/**
 * A stable attachment name for a screenshot of one page in the extension context.
 *
 * Wallet pages deliberately drop the `chrome-extension://` host: the extension id is regenerated
 * for every run, so including it would give the same screenshot a different name each time and
 * make report diffs useless. `index` is only a fallback for pages with no useful URL.
 */
export function attachmentNameForPageUrl(url: string, index: number): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `screenshot-page-${index}`;
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return `screenshot-dapp-${slug(parsed.host)}`;
  }

  if (parsed.protocol === 'chrome-extension:') {
    const file = (parsed.pathname.split('/').filter(Boolean).pop() ?? 'page').replace(/\.html?$/i, '');
    // MetaMask and Leather both route inside a single HTML entry point, so the hash is the only
    // part that says which screen was on display.
    const route = parsed.hash.replace(/^#\/?/, '').split(/[/?]/).filter(Boolean).pop() ?? '';
    return `screenshot-wallet-${[file, route].filter(Boolean).map(slug).join('-')}`;
  }

  return `screenshot-page-${index}`;
}

/** Attachment names end up in file paths; keep them to characters every filesystem accepts. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The live console reporter plus an HTML report that carries the attachments. `open: 'never'` by
 * default so a CI run does not try to spawn a browser; open it afterwards with
 * `pnpm exec playwright show-report`.
 */
export function walletReporters(
  options: { outputFolder?: string; open?: 'never' | 'on-failure' | 'always' } = {},
): PlaywrightTestConfig['reporter'] {
  const { outputFolder = 'playwright-report', open = 'never' } = options;
  return [
    ['list'],
    ['html', { outputFolder, open }],
  ];
}

/**
 * Wraps a Playwright config so wallet runs produce a full artifact set, without overwriting
 * anything the caller decided for themselves: a config that already names a `reporter` keeps it
 * verbatim, and each of `use.video`/`use.screenshot`/`use.trace` is filled in only when absent.
 * Every other key passes through untouched, and the input object is never mutated.
 */
export function withWalletReporting<T extends PlaywrightTestConfig>(config: T): T {
  const use: Record<string, unknown> = { ...(config.use ?? {}) };
  for (const [key, mode] of Object.entries(DEFAULT_ARTIFACT_MODES)) {
    if (use[key] === undefined) use[key] = mode;
  }

  return {
    ...config,
    reporter: config.reporter ?? walletReporters(),
    use,
  } as T;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @wallets-e2e/core test`
Expected: PASS — every test above, plus the pre-existing `evm-network`, `bdd/guards`, `bdd/mined`, `bdd/networks`, `bdd/state` and `context` suites. Read the summary line and confirm the pass count went up; a run reporting `0 tests` or all-skipped is a failure, not a pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @wallets-e2e/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/reporting/artifacts.ts packages/core/src/reporting/artifacts.test.ts
git commit -m "feat(core): add artifact mode resolution, retention and reporting config helpers"
```

---

### Task 3: `createExtensionTest` fixture factory

The piece that reattaches artifacts to the test. This file imports `@playwright/test` as a **value** (for the default `test` base), which is why it is separate from `artifacts.ts` and why no `node --test` file imports it.

**Files:**
- Create: `packages/core/src/reporting/index.ts`
- Modify: `packages/core/src/index.ts` (one re-export line)
- Modify: `packages/core/package.json` (version bump)

**Interfaces:**
- Consumes: `launchContext` and `LaunchContextOptions` from Task 1 (`./context.js`); `ArtifactMode`, `WalletArtifactOptions`, `DEFAULT_ARTIFACT_MODES`, `resolveArtifactMode`, `shouldRetainArtifact`, `attachmentNameForPageUrl` from Task 2 (`./artifacts.js`).
- Produces, used by Tasks 4 and 5:
  - `interface ExtensionFixtures { extensionContext: BrowserContext }`
  - `interface CreateExtensionTestOptions<TBase>` — fields listed in Step 1 below.
  - `createExtensionTest(options): TestType<TArgs & ExtensionFixtures, TWorkerArgs>` — a test object exposing `context`, `page` and `extensionContext`, which callers may `.extend()` further.
  - Re-exports everything from `./artifacts.js`, so consumers import `withWalletReporting` from `@wallets-e2e/core` too.

- [ ] **Step 1: Write `packages/core/src/reporting/index.ts`**

There is no unit test for this file — it only exists to drive a real browser, and its behaviour is exercised by the five example suites in Tasks 4 and 5. Verification for this task is typecheck plus build plus the first real example run in Task 4.

```ts
import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  test as playwrightTest,
  type BrowserContext,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo,
  type TestType,
  type Video,
} from '@playwright/test';
import { launchContext } from '../context.js';
import {
  DEFAULT_ARTIFACT_MODES,
  attachmentNameForPageUrl,
  resolveArtifactMode,
  shouldRetainArtifact,
  type ArtifactMode,
  type WalletArtifactOptions,
} from './artifacts.js';

export * from './artifacts.js';

/** The extra fixture `createExtensionTest` adds on top of whatever base it was given. */
export interface ExtensionFixtures {
  /**
   * The persistent, extension-loaded context. Same object as the built-in `context` fixture,
   * which this factory also overrides — the alias exists because tests written before this
   * factory destructure `extensionContext` by name.
   */
  extensionContext: BrowserContext;
}

type AnyTestArgs = PlaywrightTestArgs & PlaywrightTestOptions;
type AnyWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

export interface CreateExtensionTestOptions<
  TBase extends TestType<AnyTestArgs, AnyWorkerArgs> = TestType<AnyTestArgs, AnyWorkerArgs>,
> {
  /** Absolute path to the unpacked extension build — the directory holding `manifest.json`. */
  extensionPath: string;
  /**
   * The test object to extend. Defaults to `@playwright/test`'s `test`. A playwright-bdd project
   * MUST pass its own `test` here: `createBdd()` rejects a test object that does not already
   * carry playwright-bdd's fixtures.
   */
  base?: TBase;
  /** Prefix for the per-test temporary Chromium profile directory. Defaults to `'wallets-e2e'`. */
  profilePrefix?: string;
  /** Runs headed unless overridden, matching `launchContext` (AD-6). */
  headless?: boolean;
  /** Per-artifact override. Anything omitted falls back to the project's `use` block. */
  artifacts?: WalletArtifactOptions;
  /** Name used in the "not built" message. Defaults to the extension directory's parent name. */
  extensionName?: string;
  /** Shown in the "not built" message, e.g. `'pnpm build:metamask'`. */
  buildCommand?: string;
  /**
   * What to do when the extension is not built. `'throw'` (default) fails the test loudly.
   * `'skip'` marks it skipped — for suites that are expected to be runnable without every wallet
   * built locally.
   */
  onMissingExtension?: 'throw' | 'skip';
}

/**
 * Builds a Playwright `test` whose context is a real, extension-loaded persistent context, with
 * video, failure screenshots and a trace attached to the test that produced them.
 *
 * Why this exists: extensions only load through `chromium.launchPersistentContext`, and
 * Playwright's artifact machinery is wired to contexts *it* creates via the built-in `browser`
 * fixture. A hand-launched persistent context is invisible to it, so video files land unattached,
 * screenshot-on-failure never fires, and nothing reaches the HTML report. This fixture does that
 * work itself.
 *
 * Three fixtures are defined:
 *  - `context` — the built-in name is overridden so `@wallets-e2e/core/bdd`'s steps, which read
 *    the stock `context`/`page`, drive an extension context without knowing about extensions.
 *  - `page` — the dapp's own tab, kept distinct from the wallet's pages in the same context.
 *  - `extensionContext` — an alias of `context`, so tests written against the older hand-rolled
 *    fixtures keep compiling.
 *
 * The override never requests the built-in `browser` fixture, so no second browser is launched.
 */
export function createExtensionTest<
  TArgs extends AnyTestArgs = AnyTestArgs,
  TWorkerArgs extends AnyWorkerArgs = AnyWorkerArgs,
>(
  options: CreateExtensionTestOptions<TestType<TArgs, TWorkerArgs>>,
): TestType<TArgs & ExtensionFixtures, TWorkerArgs> {
  const {
    extensionPath,
    base = playwrightTest as unknown as TestType<TArgs, TWorkerArgs>,
    profilePrefix = 'wallets-e2e',
    headless,
    artifacts = {},
    extensionName = basename(dirname(extensionPath)),
    buildCommand,
    onMissingExtension = 'throw',
  } = options;

  return (base as TestType<TArgs, TWorkerArgs>).extend<ExtensionFixtures>({
    context: async ({}, use, testInfo) => {
      requireExtensionBuild({ extensionPath, extensionName, buildCommand, onMissingExtension, testInfo });

      const modes = resolveModes(artifacts, testInfo);
      const userDataDir = mkdtempSync(join(tmpdir(), `${profilePrefix}-${testInfo.testId}-`));
      // Per-test directory: the old shared folder produced `page@<hash>.webm` files that could
      // not be traced back to a test.
      const videoDir = testInfo.outputPath('videos');

      try {
        const context = await launchContext({
          extensionPath,
          userDataDir,
          headless,
          ...(modes.video === 'off' ? {} : { recordVideoDir: videoDir }),
        });
        const videos = trackVideos(context);

        if (modes.trace !== 'off') {
          await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        }

        try {
          await use(context);
        } finally {
          // Order is load-bearing: screenshots and tracing need a live context, and video files
          // are only flushed to disk once the context has closed.
          await captureFailureScreenshots(context, testInfo, modes.screenshot);
          await stopTracing(context, testInfo, modes.trace);
          await context.close();
          await attachVideos(videos, videoDir, testInfo, modes.video);
        }
      } finally {
        // Best effort, and in a `finally` so a launch that throws after mkdtemp still cleans up:
        // each leaked Chromium profile is tens of megabytes.
        rmSync(userDataDir, { recursive: true, force: true });
      }
    },

    page: async ({ context }, use) => {
      // The dapp's tab. The wallet's own pages open in this same context, so giving the dapp an
      // explicit page keeps a step's `page` unambiguous.
      const page = await context.newPage();
      await use(page);
    },

    extensionContext: async ({ context }, use) => {
      await use(context);
    },
    // Playwright's `extend` cannot see that we are overriding two of its own fixtures with
    // compatible ones; the cast keeps the public signature honest without loosening it.
  } as never) as TestType<TArgs & ExtensionFixtures, TWorkerArgs>;
}

function requireExtensionBuild(args: {
  extensionPath: string;
  extensionName: string;
  buildCommand?: string;
  onMissingExtension: 'throw' | 'skip';
  testInfo: TestInfo;
}): void {
  const { extensionPath, extensionName, buildCommand, onMissingExtension, testInfo } = args;
  if (existsSync(join(extensionPath, 'manifest.json'))) return;

  const message =
    `${extensionName} is not built at ${extensionPath}.` +
    (buildCommand ? ` Build it first: ${buildCommand}` : '');

  if (onMissingExtension === 'skip') {
    testInfo.skip(true, message);
    return;
  }
  throw new Error(`[@wallets-e2e/core] ${message}`);
}

function resolveModes(
  artifacts: WalletArtifactOptions,
  testInfo: TestInfo,
): Required<WalletArtifactOptions> {
  // `testInfo.project.use` is the resolved `use` block for the running project — the same place
  // stock Playwright reads these from, so users configure artifacts the ordinary way.
  const projectUse = (testInfo.project.use ?? {}) as Record<string, unknown>;
  return {
    video: resolveArtifactMode(artifacts.video, projectUse.video, DEFAULT_ARTIFACT_MODES.video),
    screenshot: resolveArtifactMode(
      artifacts.screenshot,
      projectUse.screenshot,
      DEFAULT_ARTIFACT_MODES.screenshot,
    ),
    trace: resolveArtifactMode(artifacts.trace, projectUse.trace, DEFAULT_ARTIFACT_MODES.trace),
  };
}

interface TrackedVideo {
  video: Video;
  /** The page's last known URL, captured while it was still open — used only for logging parity. */
  url: string;
}

/**
 * Records every page's `Video` handle as it opens. Handles must be collected *before*
 * `context.close()`, because `context.pages()` is empty afterwards — but `video.path()` only
 * resolves *after* the close has flushed the file.
 */
function trackVideos(context: BrowserContext): TrackedVideo[] {
  const tracked: TrackedVideo[] = [];

  const track = (page: Page): void => {
    const video = page.video();
    if (!video) return;
    const entry: TrackedVideo = { video, url: page.url() };
    tracked.push(entry);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) entry.url = frame.url();
    });
  };

  context.pages().forEach(track);
  context.on('page', track);
  return tracked;
}

/** Screenshots every open page — the dapp *and* the wallet's popup, which is the whole point. */
async function captureFailureScreenshots(
  context: BrowserContext,
  testInfo: TestInfo,
  mode: ArtifactMode,
): Promise<void> {
  if (!shouldRetainArtifact(mode, testInfo.status, testInfo.expectedStatus)) return;

  const usedNames = new Map<string, number>();
  let index = 0;

  for (const page of context.pages()) {
    index += 1;
    if (page.isClosed()) continue;
    try {
      const baseName = attachmentNameForPageUrl(page.url(), index);
      const seen = (usedNames.get(baseName) ?? 0) + 1;
      usedNames.set(baseName, seen);
      const name = seen === 1 ? baseName : `${baseName}-${seen}`;

      const body = await page.screenshot({ timeout: 15_000 });
      await testInfo.attach(name, { body, contentType: 'image/png' });
    } catch {
      // A page that crashed, is mid-navigation, or is already tearing down must never replace the
      // test's real failure with an artifact error.
    }
  }
}

async function stopTracing(
  context: BrowserContext,
  testInfo: TestInfo,
  mode: ArtifactMode,
): Promise<void> {
  if (mode === 'off') return;
  try {
    if (!shouldRetainArtifact(mode, testInfo.status, testInfo.expectedStatus)) {
      await context.tracing.stop();
      return;
    }
    const path = testInfo.outputPath('trace.zip');
    await context.tracing.stop({ path });
    // The name must be exactly `trace`: Playwright's HTML reporter special-cases it and renders a
    // "view trace" link instead of a plain download.
    await testInfo.attach('trace', { path, contentType: 'application/zip' });
  } catch {
    // Never let artifact collection fail a test.
  }
}

async function attachVideos(
  tracked: TrackedVideo[],
  videoDir: string,
  testInfo: TestInfo,
  mode: ArtifactMode,
): Promise<void> {
  if (mode === 'off') return;

  const retain = shouldRetainArtifact(mode, testInfo.status, testInfo.expectedStatus);
  const handled = new Set<string>();
  let index = 0;

  const take = async (path: string): Promise<void> => {
    if (handled.has(path)) return;
    handled.add(path);
    index += 1;
    if (!retain) {
      try {
        unlinkSync(path);
      } catch {
        // Already gone, or never written. Nothing to do.
      }
      return;
    }
    // The first attachment is named exactly `video` so the HTML reporter renders it as a player.
    await testInfo.attach(index === 1 ? 'video' : `video-${index}`, {
      path,
      contentType: 'video/webm',
    });
  };

  try {
    for (const entry of tracked) {
      let path: string | undefined;
      try {
        path = await entry.video.path();
      } catch {
        continue;
      }
      if (path) await take(path);
    }

    // Popup windows can open and close faster than the `page` event bookkeeping sees them, so the
    // directory Chromium actually wrote to is the ground truth for what exists.
    if (existsSync(videoDir)) {
      for (const file of readdirSync(videoDir)) {
        if (file.endsWith('.webm')) await take(join(videoDir, file));
      }
    }
  } catch {
    // Never let artifact collection fail a test.
  }
}
```

- [ ] **Step 2: Re-export from the package root**

In `packages/core/src/index.ts`, directly under the `./context.js` re-export added in Task 1:

```ts
export * from './reporting/index.js';
```

- [ ] **Step 3: Bump the package version**

In `packages/core/package.json`, change `"version": "0.1.3"` to `"version": "0.2.0"`. New public API, no breaking change.

- [ ] **Step 4: Typecheck and build**

Run: `pnpm --filter @wallets-e2e/core typecheck && pnpm --filter @wallets-e2e/core build && pnpm --filter @wallets-e2e/core test`
Expected: all PASS. The build must emit `dist/reporting/index.js`, `dist/reporting/index.d.ts` and `dist/reporting/artifacts.js`, and must **not** emit `dist/reporting/artifacts.test.js`.

Verify that last point explicitly:

```bash
ls packages/core/dist/reporting/
test ! -f packages/core/dist/reporting/artifacts.test.js && echo "OK: test file excluded from build"
```

If the generic signature of `createExtensionTest` fights the typechecker, fix the types — do not weaken the return type to `any`. The `as never` cast on the fixture object is deliberate and sufficient; the outer signature must stay precise, because Tasks 4 and 5 rely on `extensionContext` being visible to consumers.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reporting/index.ts packages/core/src/index.ts packages/core/package.json
git commit -m "feat(core): add createExtensionTest fixture factory with video, screenshot and trace capture"
```

---

### Task 4: Migrate the three non-BDD examples

Three example packages hand-roll the same fixture. They collapse to a `createExtensionTest` call. Note the behavioural detail this task must preserve: **`examples/spike` and `examples/react-connect` skip when the extension is not built; `examples/metamask-spike` throws.** That is what `onMissingExtension` is for.

**Files:**
- Modify: `examples/spike/tests/fixtures.ts`, `examples/spike/playwright.config.ts`
- Modify: `examples/react-connect/tests/fixtures.ts`, `examples/react-connect/playwright.config.ts`
- Modify: `examples/metamask-spike/tests/fixtures.ts`, `examples/metamask-spike/playwright.config.ts`
- Delete: the untracked `examples/*/test-results/` directories

**Interfaces:**
- Consumes: `createExtensionTest` and `withWalletReporting` from Task 3.
- Produces: nothing later tasks depend on, except the proof that the factory works.

- [ ] **Step 1: Rewrite `examples/spike/tests/fixtures.ts`**

```ts
import { join } from 'node:path';
import { createExtensionTest } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

/**
 * A real, launched Leather context — video-recorded, traced, screenshotted on failure and
 * auto-closed, with every artifact attached to the test in the HTML report. Skips rather than
 * fails when Leather has not been built locally.
 */
export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-spike',
  extensionName: 'Leather',
  buildCommand: 'bash wallets/leather/scripts/build-extension.sh',
  onMissingExtension: 'skip',
});

export { expect } from '@playwright/test';
```

- [ ] **Step 2: Rewrite `examples/react-connect/tests/fixtures.ts`**

Only the `extensionContext` fixture body is replaced. The three layered fixtures below it are unchanged — they still build on `extensionContext`, which the factory provides.

```ts
import { join } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createExtensionTest, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

type Fixtures = {
  /** Same context, already unlocked via the fixture wallet (Story 1.1's proven flow). */
  unlockedContext: BrowserContext;
  /** Already unlocked AND connected to this app — the shared setup every sign test needs. */
  connectedApp: { context: BrowserContext; appPage: Page };
  /**
   * Like `connectedApp`, but also switched to Leather's testnet network first — required before
   * any chain-aware operation (Story 1.4 discovery: Leather defaults to mainnet, which crashes
   * its own fee-estimation step outright for an account with no mainnet balance). What the
   * transfer and contract-call tests need.
   */
  connectedAppOnTestnet: { context: BrowserContext; appPage: Page };
};

/**
 * `extensionContext` — the real, launched, artifact-collecting Leather context — comes from
 * `createExtensionTest`. The fixtures below layer on top of it, each adding only as much setup as
 * a given test actually needs.
 */
export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e',
  extensionName: 'Leather',
  buildCommand: 'bash wallets/leather/scripts/build-extension.sh',
  onMissingExtension: 'skip',
}).extend<Fixtures>({
  unlockedContext: async ({ extensionContext }, use) => {
    await leatherDriver.importWallet(extensionContext, wallet.seedPhrase);
    await use(extensionContext);
  },

  connectedApp: async ({ unlockedContext }, use) => {
    const appPage = await unlockedContext.newPage();
    await appPage.goto('/');
    await leatherDriver.connectToDapp(unlockedContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
      await selectWalletInStacksConnectModal(appPage, 'Leather');
    });
    await expect(appPage.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });
    await use({ context: unlockedContext, appPage });
  },

  connectedAppOnTestnet: async ({ unlockedContext }, use) => {
    await leatherDriver.switchNetwork?.(unlockedContext, wallet.network);

    const appPage = await unlockedContext.newPage();
    await appPage.goto('/');
    await leatherDriver.connectToDapp(unlockedContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
      await selectWalletInStacksConnectModal(appPage, 'Leather');
    });
    await expect(appPage.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });
    await use({ context: unlockedContext, appPage });
  },
});

export { expect };
```

- [ ] **Step 3: Rewrite `examples/metamask-spike/tests/fixtures.ts`**

```ts
import { join } from 'node:path';
import { createExtensionTest } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/metamask/dist');

export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-metamask-spike',
  extensionName: 'MetaMask',
  buildCommand: 'pnpm build:metamask (or bash wallets/metamask/scripts/build-extension.sh)',
});

export { expect } from '@playwright/test';
```

`1-1-load-and-unlock.spec.ts` in this package passes an explicit `recordVideoDir` to a direct `launchContext` call in its "missing extension build" test. Leave that test exactly as it is — it asserts `launchContext`'s own error path, and `recordVideoDir` is still accepted.

- [ ] **Step 4: Wrap the three configs**

`examples/spike/playwright.config.ts` — replace the whole file:

```ts
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

/**
 * NFR2: Playwright's bundled Chromium only (`channel: 'chromium'`) — never branded Chrome/Edge.
 * `withWalletReporting` supplies the reporter pair (list + HTML) and the video/screenshot/trace
 * modes; `createExtensionTest` in `tests/fixtures.ts` is what actually collects them from the
 * persistent extension context, which Playwright's own artifact machinery cannot see.
 */
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

`examples/react-connect/playwright.config.ts` — replace the whole file:

```ts
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

/**
 * NFR2: Playwright's bundled Chromium only. Artifacts (video, failure screenshots of the dapp and
 * the wallet popup, trace) come from `withWalletReporting` + `createExtensionTest`. Auto-starts
 * the real Vite dev server so `pnpm test` here is self-contained — no separate "run dev first".
 */
export default withWalletReporting(
  defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    timeout: 120_000,
    use: {
      channel: 'chromium',
      baseURL: 'http://localhost:5173',
    },
    webServer: {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  }),
);
```

`examples/metamask-spike/playwright.config.ts` — replace the whole file:

```ts
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

export default withWalletReporting(
  defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    timeout: 300_000,
    use: {
      channel: 'chromium',
      baseURL: 'http://127.0.0.1:3456',
    },
    webServer: {
      command: 'pnpm exec vite --config vite.config.ts --host 127.0.0.1',
      url: 'http://127.0.0.1:3456',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  }),
);
```

In all three the old `reporter: [['list']]` and `use.video: 'on'` lines are gone — `withWalletReporting` supplies both, and it supplies `screenshot` and `trace` on top.

- [ ] **Step 5: Delete the stale video residue**

```bash
rm -rf examples/*/test-results
git status --short   # must show no deletions: these directories were never tracked
```

The eleven `page@<hash>.webm` files under `examples/bdd/test-results/videos/` are exactly the orphan-artifact problem this feature fixes. `.gitignore` already covers `test-results/`, `playwright-report/` and `blob-report/`, so no ignore change is needed.

- [ ] **Step 6: Typecheck all three, and prove the configs and fixtures actually load**

```bash
pnpm --filter @wallets-e2e/core build
pnpm -C examples/spike exec tsc --noEmit
pnpm -C examples/react-connect exec tsc --noEmit
pnpm -C examples/metamask-spike exec tsc --noEmit
pnpm -C examples/spike exec playwright test --list
pnpm -C examples/react-connect exec playwright test --list
```

`--list` loads the config and imports every spec file without running a browser, so it catches a broken fixture wiring or a bad import in seconds. Expected: each command exits 0 and prints the suite's tests.

Skip `--list` for `metamask-spike` if `wallets/metamask/.env.local` is absent — its fixture module throws at import time on a missing `WALLETS_E2E_SEED_PHRASE`, which is by design and not a regression. `tsc --noEmit` still covers it.

- [ ] **Step 7: Run one suite for real**

`examples/spike` is the cheapest honest end-to-end check: one test, a checked-in zero-value Leather seed, no funded account and no testnet block wait.

```bash
pnpm build:leather                      # only if wallets/leather/dist/manifest.json is missing
pnpm -C examples/spike exec playwright test
pnpm -C examples/spike exec playwright show-report
```

**Read the summary line and confirm a test actually executed.** `onMissingExtension: 'skip'` means an unbuilt Leather produces `1 skipped` — and an all-skipped Playwright run still exits 0 and prints nothing that looks like failure. A skipped run proves nothing; build the extension and re-run.

In the report, confirm on the passing test: a `video` attachment that plays. Then force a failure to check the rest — temporarily add `await expect(1).toBe(2);` at the end of the test body, re-run, and confirm the report now also carries a `trace` attachment with a "view trace" link and at least one `screenshot-*` attachment. **Revert that temporary assertion before committing.**

- [ ] **Step 8: Commit**

```bash
git add examples/spike examples/react-connect examples/metamask-spike
git commit -m "refactor(examples): use createExtensionTest and withWalletReporting in non-BDD examples"
```

---

### Task 5: Migrate the two BDD examples

These exercise the `base` option — the reason `createExtensionTest` is generic over its base at all. `@wallets-e2e/core/bdd`'s steps read the stock `context` and `page`, which is exactly what the factory overrides, so the steps keep working untouched.

**Files:**
- Modify: `examples/bdd/steps/fixtures.ts`, `examples/bdd/playwright.config.ts`
- Modify: `examples/metamask-bdd/steps/fixtures.ts`, `examples/metamask-bdd/playwright.config.ts`

**Interfaces:**
- Consumes: `createExtensionTest`, `withWalletReporting` (Task 3); `createWalletSteps` from `@wallets-e2e/core/bdd`, unchanged.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Rewrite `examples/bdd/steps/fixtures.ts`**

```ts
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { createExtensionTest } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
// `test` must come from playwright-bdd, not @playwright/test: createBdd() asserts the custom test
// it is handed already carries playwright-bdd's own fixtures, and exits with a message rather than
// a type error if it doesn't.
import { test as bddTest } from 'playwright-bdd';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

/**
 * `createExtensionTest` overrides the built-in `context` and `page`, which is precisely what makes
 * `@wallets-e2e/core/bdd`'s steps work: they read the stock fixture names and stay wallet- and
 * project-agnostic, while everything extension-specific — where the unpacked build lives, the
 * per-test profile, and the video/screenshot/trace collection — is handled by the factory.
 *
 * `base` is the playwright-bdd test, not Playwright's: the generated specs import this object, and
 * `createBdd()` rejects a test that does not already carry playwright-bdd's fixtures.
 */
export const test = createExtensionTest({
  base: bddTest,
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-bdd',
  extensionName: 'Leather',
  buildCommand: 'pnpm build:leather',
});

/**
 * Registers the coarse wallet steps this project ships, and hands back the same binders the
 * dapp-language steps in this folder are written with. The seed phrase, the driver and the wallet's
 * name in `@stacks/connect`'s picker are all injected here — which is why no `.feature` file in
 * this example mentions any of them.
 */
export const { Given, When, Then } = createWalletSteps({
  test,
  driver: leatherDriver,
  seedPhrase: wallet.seedPhrase,
  walletName: 'Leather',
  connectTestId: 'connect-wallet',
});

export { expect };
```

- [ ] **Step 2: Rewrite `examples/metamask-bdd/steps/fixtures.ts`**

```ts
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { createExtensionTest } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test as bddTest } from 'playwright-bdd';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/metamask/dist');

export const test = createExtensionTest({
  base: bddTest,
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-metamask-bdd',
  extensionName: 'MetaMask',
  buildCommand: 'pnpm build:metamask',
});

export const { Given, When, Then } = createWalletSteps({
  test,
  driver: metamaskDriver,
  seedPhrase: wallet.seedPhrase,
  walletName: 'MetaMask',
  connect: async (page) => {
    await page.getByTestId('connect-wallet').click();
  },
});

export { expect };
```

- [ ] **Step 3: Wrap the two BDD configs**

`examples/bdd/playwright.config.ts`:

```ts
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';
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

export default withWalletReporting(
  defineConfig({
    testDir,
    fullyParallel: false,
    workers: 1,
    // Matches examples/react-connect. The one scenario that waits on a real testnet block (~10
    // minutes) raises its own ceiling with a `@timeout:` tag instead, so a stuck popup here still
    // fails in two minutes rather than twenty.
    timeout: 120_000,
    use: {
      channel: 'chromium',
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
  }),
);
```

`examples/metamask-bdd/playwright.config.ts`:

```ts
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: './features/**/*.feature',
  steps: ['./steps/**/*.ts'],
});

export default withWalletReporting(
  defineConfig({
    testDir,
    fullyParallel: false,
    workers: 1,
    timeout: 600_000,
    use: {
      channel: 'chromium',
      baseURL: 'http://127.0.0.1:3456',
    },
    webServer: {
      command: 'pnpm exec vite --config vite.config.ts --host 127.0.0.1',
      cwd: join(import.meta.dirname, '../metamask-spike'),
      url: 'http://127.0.0.1:3456',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  }),
);
```

- [ ] **Step 4: Typecheck and list**

```bash
pnpm -C examples/bdd exec tsc --noEmit
pnpm -C examples/metamask-bdd exec tsc --noEmit
pnpm -C examples/bdd exec bddgen && pnpm -C examples/bdd exec playwright test --list
```

Expected: exit 0 from each; the last one prints the scenarios from `features/transfer.feature`. `bddgen` must run first — `--list` points at `.features-gen/`, which does not exist until it does.

Skip the `metamask-bdd` list step if `wallets/metamask/.env.local` is absent, for the same import-time reason as Task 4.

If the typechecker rejects `base: bddTest` — playwright-bdd's `test` carries extra fixtures — fix the generic constraint on `CreateExtensionTestOptions` in `packages/core/src/reporting/index.ts` so a wider base is accepted. Do not paper over it with `as any` at the call site.

- [ ] **Step 5: Commit**

```bash
git add examples/bdd examples/metamask-bdd
git commit -m "refactor(examples): use createExtensionTest and withWalletReporting in BDD examples"
```

---

### Task 6: Tutorial and README updates

**Files:**
- Create: `tutorials/reports-and-artifacts.md`
- Modify: `README.md` (root)
- Modify: `packages/core/README.md`

**Interfaces:**
- Consumes: the finished public API from Tasks 2 and 3, and the migrated examples from Tasks 4 and 5 — every snippet below must match what those tasks actually shipped.

- [ ] **Step 1: Write `tutorials/reports-and-artifacts.md`**

Match the voice of `tutorials/quick-start.md` and `tutorials/feature-files.md` — read both first. Cover these sections, in this order:

1. **What you get.** One HTML report per run carrying, per test: a playable video, a trace, and on failure a screenshot of *every* page in the context — the dapp **and** the wallet's own popup. State plainly why this needs a package feature at all: extensions only load through `chromium.launchPersistentContext`, and Playwright's artifact machinery only sees contexts it created itself, so on a stock setup videos land as unattributable `page@<hash>.webm` files and screenshot-on-failure never fires.
2. **Wiring it up.** Two changes. Wrap the config in `withWalletReporting(defineConfig({ ... }))`, and build the fixture with `createExtensionTest({ extensionPath, ... })`. Show the real before/after for `examples/spike/tests/fixtures.ts` — roughly 30 lines down to 8. Include the playwright-bdd variant with `base: bddTest` and the note that `createBdd()` rejects a non-bdd test object.
3. **Running and opening.** `pnpm test`, then `pnpm exec playwright show-report`.
4. **Reading a failure.** Which artifact answers which question: the video for "what did the user see", the wallet screenshot for "what did the popup say at the moment it broke", the trace for "what exactly did the test do, with DOM snapshots". Note that `trace.zip` also opens at `pnpm exec playwright show-trace <path>` or trace.playwright.dev.
5. **Tuning.** The `use.video` / `use.screenshot` / `use.trace` modes, the precedence chain (`artifacts` option → project `use` → package default), the defaults (`video: 'on'`, `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`), and where raw files land: `test-results/<test-id>/`.
6. **CI note.** `playwright-report/` and `test-results/` are gitignored — upload them as CI artifacts. A failing wallet run's `trace.zip` can be several MB, which is why `retain-on-failure` rather than `on` is the default.

Every code block must be copied from the files Tasks 3–5 actually produced, not paraphrased.

- [ ] **Step 2: Link it from the root README**

`README.md` already links tutorials at line 70 (`quick-start.md`) and line 106 (`feature-files.md`). Read the surrounding sections and add a matching section for reports and artifacts in the same house style, linking `./tutorials/reports-and-artifacts.md`. Follow the existing arrow-and-bold convention rather than inventing a new one.

- [ ] **Step 3: Update `packages/core/README.md`**

Two edits:

1. In the "What's exported" list, update the `launchContext` bullet — `recordVideoDir` is now optional — and add bullets for the new API, in the list's existing voice:

```markdown
- `createExtensionTest({ extensionPath, base?, artifacts?, ... })` — a Playwright `test` whose `context`/`page`/`extensionContext` are a real extension-loaded persistent context, with video, failure screenshots (the dapp *and* the wallet's own popup pages) and a trace attached to the test that produced them. Pass `base` to build on playwright-bdd's `test`.
- `withWalletReporting(config)` — wraps a Playwright config with the list + HTML reporters and the `video`/`screenshot`/`trace` modes, never overwriting anything you set yourself.
- `walletReporters({ outputFolder?, open? })` — just the reporter pair, for configs that assemble their own.
- `ArtifactMode`, `WalletArtifactOptions`, `DEFAULT_ARTIFACT_MODES` — the artifact retention vocabulary.
```

2. In "Full docs", add the new tutorial next to the quick-start link, using the same absolute GitHub URL form the file already uses.

- [ ] **Step 4: Verify the links resolve**

```bash
grep -n "reports-and-artifacts" README.md packages/core/README.md tutorials/reports-and-artifacts.md
test -f tutorials/reports-and-artifacts.md && echo "tutorial exists"
```

Expected: the root README and the core README each reference the tutorial, and the file exists.

- [ ] **Step 5: Commit**

```bash
git add tutorials/reports-and-artifacts.md README.md packages/core/README.md
git commit -m "docs: add reports and artifacts tutorial, document the new core exports"
```

---

### Task 7: Full-workspace verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Build and test the whole workspace**

```bash
pnpm build
pnpm --filter @wallets-e2e/core test
```

Expected: turbo builds every package with no TypeScript errors; the core suite passes with a non-zero executed-test count.

- [ ] **Step 2: Confirm AD-1 still holds**

```bash
grep -rn "launchPersistentContext" --include="*.ts" packages wallets examples | grep -v node_modules | grep -v "/lib/" | grep -v "/dist/"
```

Expected: exactly one hit, in `packages/core/src/context.ts`.

- [ ] **Step 3: Confirm no example still hand-rolls a context**

```bash
grep -rln "mkdtempSync" --include="*.ts" examples | grep -v node_modules
```

Expected: no output. Every example now gets its profile directory from `createExtensionTest`.

- [ ] **Step 4: Review the full diff before finishing**

```bash
git log --oneline main..HEAD
git diff main...HEAD --stat
```

Confirm the changed-file list matches the spec's "Files changed" section, and that nothing unintended (a `.env.local`, a `test-results/` directory, a seed phrase) crept in.

- [ ] **Step 5: Report honestly**

State which suites actually executed and which were skipped or not run for lack of a built extension or funded testnet account. Do not describe a skipped or unrun suite as passing.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: module boundary → Tasks 1–3; public surface → Tasks 2–3; `createExtensionTest` fixture table → Task 3; artifact lifecycle steps 1–7 → Task 3 Step 1; mode resolution → Task 2; `withWalletReporting` → Task 2; back-compat (optional `recordVideoDir`, version bump) → Tasks 1 and 3; testing → Tasks 1, 2 and 7; files-changed list → Tasks 4, 5 and 6; tutorial outline → Task 6; risks → covered by the non-fatal try/catch blocks in Task 3 and the CI note in Task 6.

**One addition beyond the spec:** `onMissingExtension: 'throw' | 'skip'`. The spec assumed all five examples throw, but `examples/spike` and `examples/react-connect` currently call `testInfo.skip(...)`. Preserving both behaviours needs the option; migrating without it would silently change two suites from "skipped when unbuilt" to "failing when unbuilt".

**Type consistency.** `createExtensionTest`, `withWalletReporting`, `walletReporters`, `resolveArtifactMode`, `shouldRetainArtifact`, `attachmentNameForPageUrl`, `DEFAULT_ARTIFACT_MODES`, `ExtensionFixtures`, `ArtifactMode` and `WalletArtifactOptions` are spelled identically in every task that defines, imports or documents them. `resolveArtifactMode`'s three-argument order (explicit, project use, fallback) matches between its test in Task 2 and its four call sites in Task 3's `resolveModes`.
