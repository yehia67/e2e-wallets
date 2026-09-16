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
} from '@playwright/test';
import { launchContext } from '../context.js';
import {
  DEFAULT_ARTIFACT_MODES,
  resolveArtifactMode,
  shouldRetainArtifact,
  WALLET_SCREENSHOT_USE_KEY,
  type ArtifactMode,
  type WalletArtifactOptions,
} from './artifacts.js';
import { isNonVisualPageUrl, nameScreenshotEntries, nameVideoEntries } from './video-names.js';
import { orderVideoEntriesForAttachment } from './video-order.js';
import { trackVideos, type TrackedVideo } from './video-recorder.js';
import { composeVideo } from './video-composition.js';
import type { VideoSegment } from './video-timeline.js';

export * from './artifacts.js';
export {
  isNonVisualPageUrl,
  nameScreenshotEntries,
  nameVideoEntries,
  type NameVideoOptions,
  type VideoAttachmentName,
  type VideoRole,
} from './video-names.js';

/** Extra fixture `createExtensionTest` adds on top of whatever base it was given. */
export interface ExtensionFixtures {
  /** Same object as the (overridden) `context` fixture; kept for callers that destructure it by name. */
  extensionContext: BrowserContext;
}

type AnyTestArgs = PlaywrightTestArgs & PlaywrightTestOptions;
type AnyWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

export interface CreateExtensionTestOptions<
  TBase extends TestType<AnyTestArgs, AnyWorkerArgs> = TestType<AnyTestArgs, AnyWorkerArgs>,
> {
  /** Absolute path to the unpacked extension build — the directory holding `manifest.json`. */
  extensionPath: string;
  /** The test object to extend. Defaults to `@playwright/test`'s `test`. */
  base?: TBase;
  /** Prefix for the per-test temporary Chromium profile directory. Defaults to `'wallets-e2e'`. */
  profilePrefix?: string;
  /** Runs headed unless overridden, matching `launchContext` (AD-6). */
  headless?: boolean;
  /** Video/screenshot retention overrides and video composition options. Trace uses `use.trace`. */
  artifacts?: WalletArtifactOptions;
  /** Name used in the "not built" message. Defaults to the extension directory's parent name. */
  extensionName?: string;
  /** Shown in the "not built" message, e.g. `'pnpm build:metamask'`. */
  buildCommand?: string;
  /** What to do when the extension is not built. `'throw'` (default) fails the test; `'skip'` marks it skipped. */
  onMissingExtension?: 'throw' | 'skip';
}

/**
 * Builds a Playwright `test` whose context is a real, extension-loaded persistent context. Playwright
 * traces and screenshots such a context by itself; only the recorded video needs attaching by hand.
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
    // Playwright drives its own tracing and screenshots off these two worker options, for
    // hand-launched persistent contexts as much as for its own. Restated here so the package
    // defaults apply without `withWalletReporting`; `use.trace`/`use.screenshot` still override.
    trace: [DEFAULT_ARTIFACT_MODES.trace, { option: true, scope: 'worker', box: true }],
    // Playwright screenshots every page in the context as soon as the test body ends — before any
    // fixture can filter — which in an extension context means the wallet's invisible worker pages
    // too. The package takes its own instead, of the pages worth looking at; `artifacts.screenshot`
    // and `use.screenshot` still choose when.
    screenshot: ['off', { option: true, scope: 'worker', box: true }],

    // The built-in `context` name is overridden so bdd steps that read the stock `context`/`page`
    // drive an extension context without knowing about extensions.
    context: async (
      {}: Record<string, never>,
      use: (context: BrowserContext) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      requireExtensionBuild({ extensionPath, extensionName, buildCommand, onMissingExtension, testInfo });

      const videoMode = resolveVideoMode(artifacts, testInfo);
      const userDataDir = mkdtempSync(join(tmpdir(), `${profilePrefix}-${testInfo.testId}-`));
      const videoDir = testInfo.outputPath('videos');

      try {
        const context = await launchContext({
          extensionPath,
          userDataDir,
          headless,
          ...(videoMode === 'off' ? {} : { recordVideoDir: videoDir }),
        });
        let recording: Awaited<ReturnType<typeof trackVideos>> | undefined;
        try {
          recording = await trackVideos(context, videoMode !== 'off' && artifacts.videoLayout !== 'separate');
          await use(context);
        } finally {
          // End the timeline before teardown starts closing pages and changing focus.
          const segments = recording?.stop() ?? [];
          // Taken before anything closes, while the pages are still on screen.
          await attachScreenshots(context, testInfo, resolveScreenshotMode(artifacts, testInfo));
          // Order is load-bearing: Playwright screenshots the context's pages as it closes, and
          // closing flushes the videos. Blank pages go first so they reach neither artifact.
          await closeNonVisualPages(context);
          try {
            await context.close();
          } catch {
            // A crashed browser can reject close(); attachVideos must still run.
          }
          const combined = await attachCombinedVideo(segments, testInfo, videoMode, artifacts);
          await attachVideos(recording?.videos ?? [], videoDir, testInfo,
            combined ? 'off' : videoMode, artifacts);
          if (combined) rmSync(videoDir, { recursive: true, force: true });
        }
      } finally {
        rmSync(userDataDir, { recursive: true, force: true });
      }
    },

    page: async (
      { context }: { context: BrowserContext },
      use: (page: Page) => Promise<void>,
    ) => {
      // A persistent context opens with a blank page. Taking that one over,
      // rather than adding a second, keeps the run free of a page that shows
      // nothing: Playwright screenshots every page in the context when a test
      // ends, and records one video per page, so a leftover blank page costs a
      // blank image and a blank player in every report.
      const existing = context.pages().find((candidate) => isNonVisualPageUrl(candidate.url()));
      const page = existing ?? (await context.newPage());
      await use(page);
    },

    extensionContext: async (
      { context }: { context: BrowserContext },
      use: (context: BrowserContext) => Promise<void>,
    ) => {
      await use(context);
    },
    // Playwright's `extend` cannot see that we are overriding two of its own fixtures with
    // compatible ones; the cast keeps the public signature honest without loosening it.
  } as never) as TestType<TArgs & ExtensionFixtures, TWorkerArgs>;
}


/**
 * Closes the pages that show nothing, before the context takes its artifacts.
 *
 * A persistent context opens with `about:blank`, and a wallet extension keeps invisible worker
 * pages such as MetaMask's `offscreen.html` open for the whole run. Playwright screenshots every
 * page in the context when a test ends and records one video per page, so each of these costs a
 * blank image and a blank player in the report.
 */
async function closeNonVisualPages(context: BrowserContext): Promise<void> {
  await Promise.all(
    context
      .pages()
      .filter((page) => !page.isClosed() && isNonVisualPageUrl(page.url()))
      .map((page) => page.close().catch(() => undefined)),
  );
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

function resolveVideoMode(artifacts: WalletArtifactOptions, testInfo: TestInfo): ArtifactMode {
  const projectUse = (testInfo.project.use ?? {}) as Record<string, unknown>;
  return resolveArtifactMode(artifacts.video, projectUse.video, DEFAULT_ARTIFACT_MODES.video);
}

function resolveScreenshotMode(artifacts: WalletArtifactOptions, testInfo: TestInfo): ArtifactMode {
  const projectUse = (testInfo.project.use ?? {}) as Record<string, unknown>;
  // `use.screenshot` itself is forced to 'off' by `withWalletReporting`, which parks the caller's
  // choice under its own key; a config that skipped that helper is read directly.
  return resolveArtifactMode(
    artifacts.screenshot,
    projectUse[WALLET_SCREENSHOT_USE_KEY] ?? projectUse.screenshot,
    DEFAULT_ARTIFACT_MODES.screenshot,
  );
}

/**
 * Screenshots the pages worth looking at, named for what they show.
 *
 * Runs while the context is still open, so every page is captured as it stood at the end of the
 * test; pages that show nothing are skipped rather than contributing a blank image.
 */

/**
 * Artifact collection swallows its own failures so it can never mask a test's real result, which
 * also means a missing screenshot or video looks exactly like one that was never wanted. Set
 * `WALLETS_E2E_DEBUG=1` to hear about it.
 */
function debugArtifacts(message: string): void {
  if (process.env.WALLETS_E2E_DEBUG === '1') console.warn(`[@wallets-e2e/core] ${message}`);
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
}

async function attachScreenshots(
  context: BrowserContext,
  testInfo: TestInfo,
  mode: ArtifactMode,
): Promise<void> {
  if (mode === 'off') return;
  if (!shouldRetainArtifact(mode, testInfo.status, testInfo.expectedStatus)) return;
  debugArtifacts(`screenshots: mode=${mode} pages=${context.pages().length}`);

  try {
    const pages = context.pages().filter((page) => !page.isClosed());
    const failed = testInfo.status !== testInfo.expectedStatus;
    const named = nameScreenshotEntries(
      pages.map((page) => ({ page, url: page.url() })),
      { approvals: failed },
    );

    for (const { entry, attachment } of named) {
      if (!attachment) continue;
      try {
        const body = await entry.page.screenshot();
        await testInfo.attach(attachment.name, { body, contentType: 'image/png' });
      } catch (cause) {
        // A page can navigate or close mid-capture; the rest still get taken.
        debugArtifacts(`screenshot of ${entry.url} failed: ${describeCause(cause)}`);
      }
    }
  } catch {
    // Artifact collection must never mask the test's real failure.
  }
}

async function attachCombinedVideo(
  segments: VideoSegment<TrackedVideo>[],
  testInfo: TestInfo,
  mode: ArtifactMode,
  artifacts: WalletArtifactOptions,
): Promise<boolean> {
  if (artifacts.videoLayout === 'separate' || segments.length === 0 ||
      !shouldRetainArtifact(mode, testInfo.status, testInfo.expectedStatus)) return false;
  const output = testInfo.outputPath('video-combined.webm');
  try {
    const clips = await Promise.all(segments.map(async ({ source, start, end }) => ({
      path: await source.video.path(),
      offset: Math.max(0, start - source.startedAt) / 1000,
      duration: (end - start) / 1000,
    })));
    await composeVideo(clips, output, artifacts.ffmpegPath);
    await testInfo.attach('video', { path: output, contentType: 'video/webm' });
    return true;
  } catch (cause) {
    console.warn(`[@wallets-e2e/core] Combined video unavailable; retaining separate page videos. ` +
      `Install FFmpeg on PATH or set artifacts.ffmpegPath. ${describeCause(cause)}`);
    return false;
  } finally {
    rmSync(output, { force: true });
  }
}

async function attachVideos(
  tracked: TrackedVideo[],
  videoDir: string,
  testInfo: TestInfo,
  mode: ArtifactMode,
  artifacts: WalletArtifactOptions,
): Promise<void> {
  if (mode === 'off') return;

  const retain = shouldRetainArtifact(mode, testInfo.status, testInfo.expectedStatus);
  const handled = new Set<string>();
  let extras = 0;

  const discard = (path: string): void => {
    try {
      unlinkSync(path);
    } catch {
      // Already gone, or never written.
    }
  };

  const take = async (path: string, name: string | undefined): Promise<void> => {
    if (handled.has(path)) return;
    handled.add(path);
    // `name` is undefined for a recording of a page that never showed anything.
    if (!retain || name === undefined) {
      discard(path);
      return;
    }
    await testInfo.attach(name, { path, contentType: 'video/webm' });
  };

  try {
    const named = nameVideoEntries(orderVideoEntriesForAttachment(tracked), {
      walletHomeVideo: artifacts.walletHomeVideo ?? false,
    });
    for (const { entry, attachment } of named) {
      let path: string | undefined;
      try {
        path = await entry.video.path();
      } catch {
        continue;
      }
      if (path) await take(path, attachment?.name);
    }

    // Directory scanned as a fallback: popups can close before the `page` event bookkeeping sees them.
    // Those recordings have no URL to name them by, so they are numbered apart from the named ones.
    if (existsSync(videoDir)) {
      for (const file of readdirSync(videoDir)) {
        if (!file.endsWith('.webm')) continue;
        extras += 1;
        await take(join(videoDir, file), `video-unmatched-${extras}`);
      }
    }
  } catch {
    // Artifact collection must never mask the test's real failure.
  }
}
