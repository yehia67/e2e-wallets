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
import { launchContext, type LaunchContextOptions } from '../context.js';
import {
  DEFAULT_ARTIFACT_MODES,
  DEFAULT_PAGE_LOGS_MODE,
  resolveArtifactMode,
  resolveScreenshotVideoOptions,
  resolveVideoSource,
  shouldRetainArtifact,
  WALLET_SCREENSHOT_USE_KEY,
  type ArtifactMode,
  type WalletArtifactOptions,
} from './artifacts.js';
import { collectPageLogs, type PageLogCollector } from './page-logs.js';
import {
  encodeScreenshotVideo,
  ffmpegAvailable,
  startScreenshotRecorder,
  type FrameEntry,
  type ScreenshotRecorder,
} from './screenshot-video.js';
import { isNonVisualPageUrl, nameScreenshotEntries, nameVideoEntries, roleOf } from './video-names.js';
import { orderVideoEntriesForAttachment } from './video-order.js';
import { trackVideos, type TrackedVideo } from './video-recorder.js';
import { composeVideo } from './video-composition.js';
import type { VideoSegment } from './video-timeline.js';
import { pagesToCloseAfterTest } from './worker-context.js';

export * from './artifacts.js';
export { collectPageLogs, type PageLogCollector } from './page-logs.js';
export { trackActivity, type ActivityEvents, type ActivityTracker } from './activity-tracker.js';
export {
  buildConcatList,
  encodeScreenshotVideo,
  ffmpegEncodeArgs,
  type FrameEntry,
  type ScreenshotRecorder,
} from './screenshot-video.js';
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

/**
 * The browser a worker keeps across its tests under `contextScope: 'worker'`. Launched by the first
 * test that needs it — after that test's own extension checks have run — and closed with the worker.
 */
export interface WorkerBrowserSlot {
  launch(options: LaunchContextOptions): Promise<BrowserContext>;
  current(): BrowserContext | undefined;
}

/** Worker-scoped fixtures `createExtensionTest` adds. */
export interface ExtensionWorkerFixtures {
  walletWorkerBrowser: WorkerBrowserSlot;
}

/** How long one extension-loaded browser lives. */
export type ContextScope = 'test' | 'worker';

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
  /**
   * `'test'` (default): every test launches its own Chromium with a fresh profile, so each one
   * imports the wallet, picks its network and connects again — around half a minute per test
   * before the test's own work starts, and no state can leak between tests.
   *
   * `'worker'`: one Chromium and one profile per worker, shared by its tests in order. The wallet
   * stays imported, unlocked and on its network, and a dapp session the browser remembers is
   * restored on the next test's page. Each test still gets its own page, video, screenshots and
   * page logs; the pages a test opened are closed when it ends. Wallet drivers must then make
   * import and network selection idempotent, as `@wallets-e2e/metamask` does. The video comes from
   * screenshots in this mode: Chromium's per-page recordings cannot be cut per test.
   */
  contextScope?: ContextScope;
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
  /**
   * Runs once per test, before the extension is required, so a wallet package can fetch its own
   * build instead of making every consumer repository carry a download script. Failures fall
   * through to `onMissingExtension`, which reports them with `buildCommand` in the message.
   */
  prepareExtension?: () => Promise<unknown>;
  /**
   * Size Chromium's own recordings are made at (`videoSource: 'chromium'` only). Unset by
   * default: each page then records at its own shape and composition normalises them.
   */
  videoSize?: { width: number; height: number };
  /** Chromium's window size (`--window-size`). See `LaunchContextOptions.windowSize`. */
  windowSize?: { width: number; height: number };
  /**
   * The viewport every page in the context gets — the wallet's pages included, since they are
   * pages of this context, so it changes which layout the extension renders. Unset by default
   * (Playwright's 1280×720). A project's `use.viewport` does not reach a hand-launched context.
   */
  viewport?: { width: number; height: number };
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
    prepareExtension,
    videoSize,
    windowSize,
    viewport,
    contextScope = 'test',
  } = options;

  return (base as TestType<TArgs, TWorkerArgs>).extend<ExtensionFixtures, ExtensionWorkerFixtures>({
    // Under `contextScope: 'worker'`, the one browser the worker's tests share. A slot rather than
    // the context itself, so the launch waits for the first test's extension checks and a worker
    // whose tests all skip never starts a browser.
    walletWorkerBrowser: [
      async ({}: Record<string, never>, use: (slot: WorkerBrowserSlot) => Promise<void>, workerInfo: { workerIndex: number }) => {
        let context: BrowserContext | undefined;
        let userDataDir: string | undefined;
        const slot: WorkerBrowserSlot = {
          async launch(launchOptions) {
            if (!context) {
              userDataDir = mkdtempSync(join(tmpdir(), `${profilePrefix}-worker${workerInfo.workerIndex}-`));
              context = await launchContext({ ...launchOptions, userDataDir });
            }
            return context;
          },
          current: () => context,
        };
        try {
          await use(slot);
        } finally {
          try {
            await context?.close();
          } catch {
            // Already gone; nothing left to release.
          }
          if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
        }
      },
      { scope: 'worker' },
    ],

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
      { walletWorkerBrowser }: { walletWorkerBrowser: WorkerBrowserSlot },
      use: (context: BrowserContext) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      if (prepareExtension && !existsSync(join(extensionPath, 'manifest.json'))) {
        // Swallowed on purpose: requireExtensionBuild below turns a still-missing extension into
        // the one actionable message, rather than a fetch error from inside a fixture.
        await prepareExtension().catch(() => undefined);
      }
      requireExtensionBuild({ extensionPath, extensionName, buildCommand, onMissingExtension, testInfo });

      const videoMode = resolveVideoMode(artifacts, testInfo);
      const source = await resolveVideoSourceOnce(artifacts, videoMode);
      const videoDir = testInfo.outputPath('videos');
      const framesDir = testInfo.outputPath('video-frames');
      const pageLogsMode = resolvePageLogsMode(artifacts, testInfo);

      if (contextScope === 'worker') {
        // The worker's browser, borrowed for this test and handed back with this test's pages closed.
        const context = await walletWorkerBrowser.launch({ extensionPath, headless, videoSize, windowSize, viewport });
        const openedBefore = new Set(context.pages());
        const logs = pageLogsMode === 'off' ? undefined : collectContextLogs(context);
        let recorder: ScreenshotRecorder | undefined;
        try {
          if (videoMode !== 'off') {
            if (source === 'chromium') warnWorkerScopeRecordsScreenshots();
            recorder = await startScreenshotRecorder(context, {
              framesDir,
              options: resolveScreenshotVideoOptions(artifacts.screenshotVideo),
              scope: artifacts.videoScope ?? 'all',
              debug: debugArtifacts,
            });
          }
          await use(context);
        } finally {
          const frames = (await recorder?.stop()) ?? [];
          await attachScreenshots(context, testInfo, resolveScreenshotMode(artifacts, testInfo));
          logs?.stop();
          await Promise.all(
            pagesToCloseAfterTest(openedBefore, context.pages(), isNonVisualPageUrl).map((page) => page.close().catch(() => undefined)),
          );
          await attachScreenshotVideo(frames, framesDir, testInfo, videoMode, artifacts);
          if (logs) await attachPageLogs(logs, testInfo, pageLogsMode);
        }
        return;
      }

      const userDataDir = mkdtempSync(join(tmpdir(), `${profilePrefix}-${testInfo.testId}-`));
      try {
        const context = await launchContext({
          extensionPath,
          userDataDir,
          headless,
          videoSize,
          windowSize,
          viewport,
          ...(videoMode !== 'off' && source === 'chromium' ? { recordVideoDir: videoDir } : {}),
        });
        const logs = pageLogsMode === 'off' ? undefined : collectContextLogs(context);
        let recording: Awaited<ReturnType<typeof trackVideos>> | undefined;
        let recorder: ScreenshotRecorder | undefined;
        try {
          if (source === 'chromium') {
            recording = await trackVideos(context, videoMode !== 'off' && artifacts.videoLayout !== 'separate');
          } else if (videoMode !== 'off') {
            recorder = await startScreenshotRecorder(context, {
              framesDir,
              options: resolveScreenshotVideoOptions(artifacts.screenshotVideo),
              scope: artifacts.videoScope ?? 'all',
              debug: debugArtifacts,
            });
          }
          await use(context);
        } finally {
          // End the timeline before teardown starts closing pages and changing focus.
          const segments = recording?.stop() ?? [];
          const frames = (await recorder?.stop()) ?? [];
          // Taken before anything closes, while the pages are still on screen.
          await attachScreenshots(context, testInfo, resolveScreenshotMode(artifacts, testInfo));
          // Order is load-bearing: Playwright screenshots the context's pages as it closes, and
          // closing flushes the videos. Blank pages go first so they reach neither artifact.
          await closeNonVisualPages(context);
          logs?.stop();
          try {
            await context.close();
          } catch {
            // A crashed browser can reject close(); attachVideos must still run.
          }
          if (source === 'chromium') {
            const combined = await attachCombinedVideo(segments, testInfo, videoMode, artifacts);
            await attachVideos(recording?.videos ?? [], videoDir, testInfo,
              combined ? 'off' : videoMode, artifacts);
            if (combined) rmSync(videoDir, { recursive: true, force: true });
          } else {
            await attachScreenshotVideo(frames, framesDir, testInfo, videoMode, artifacts);
          }
          if (logs) await attachPageLogs(logs, testInfo, pageLogsMode);
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

function resolvePageLogsMode(artifacts: WalletArtifactOptions, testInfo: TestInfo): ArtifactMode {
  const projectUse = (testInfo.project.use ?? {}) as Record<string, unknown>;
  return resolveArtifactMode(artifacts.pageLogs, projectUse.pageLogs, DEFAULT_PAGE_LOGS_MODE);
}

let warnedAboutFfmpeg = false;
let warnedAboutWorkerVideo = false;

function warnWorkerScopeRecordsScreenshots(): void {
  if (warnedAboutWorkerVideo) return;
  warnedAboutWorkerVideo = true;
  console.warn(`[@wallets-e2e/core] contextScope 'worker' records the video from screenshots: ` +
    `Chromium's per-page recordings span the whole worker and cannot be cut per test.`);
}

/**
 * The video source for this test. Screenshots need FFmpeg to become a video; without it Chromium's
 * recorder is used so the run still has footage, and the worker says so once.
 */
async function resolveVideoSourceOnce(artifacts: WalletArtifactOptions, videoMode: ArtifactMode): Promise<'screenshots' | 'chromium'> {
  if (videoMode === 'off') return artifacts.videoSource ?? 'screenshots';
  const { source, fallback } = resolveVideoSource(artifacts.videoSource, await ffmpegAvailable(artifacts.ffmpegPath));
  if (fallback && !warnedAboutFfmpeg) {
    warnedAboutFfmpeg = true;
    console.warn(`[@wallets-e2e/core] videoSource 'screenshots' needs FFmpeg to encode its frames; ` +
      `none was found${artifacts.ffmpegPath ? ` at ${artifacts.ffmpegPath}` : ' on PATH'}. ` +
      `Falling back to Chromium's recorder, whose frames are cropped after a wallet popup.`);
  }
  return source;
}

/** Page logs of every page in the context, each line prefixed with the page it came from. */
function collectContextLogs(context: BrowserContext): PageLogCollector {
  const collectors = new Map<Page, PageLogCollector>();
  const attach = (page: Page): void => {
    if (!collectors.has(page)) collectors.set(page, collectPageLogs(page));
  };
  context.pages().forEach(attach);
  context.on('page', attach);
  return {
    lines: () => [...collectors.entries()].flatMap(([page, collector]) => {
      const where = roleOf(page.url()) === 'dapp' ? 'app' : roleOf(page.url());
      return collector.lines().map((line) => `[${where}] ${line}`);
    }),
    stop: () => {
      context.off('page', attach);
      collectors.forEach((collector) => collector.stop());
    },
  };
}

async function attachPageLogs(logs: PageLogCollector, testInfo: TestInfo, mode: ArtifactMode): Promise<void> {
  if (!shouldRetainArtifact(mode, testInfo.status, testInfo.expectedStatus)) return;
  const lines = logs.lines();
  if (lines.length === 0) return;
  try {
    await testInfo.attach('page-logs', { body: lines.join('\n') + '\n', contentType: 'text/plain' });
  } catch (cause) {
    debugArtifacts(`page logs not attached: ${describeCause(cause)}`);
  }
}

/**
 * Encodes the captured frames into the test's `video` attachment, or throws them away when the
 * retention mode says this test is not worth one. A failed encode keeps the frames on disk, so
 * the run can still be looked at, and says why.
 */
async function attachScreenshotVideo(
  frames: FrameEntry[],
  framesDir: string,
  testInfo: TestInfo,
  mode: ArtifactMode,
  artifacts: WalletArtifactOptions,
): Promise<void> {
  if (mode === 'off') return;
  if (frames.length === 0 || !shouldRetainArtifact(mode, testInfo.status, testInfo.expectedStatus)) {
    rmSync(framesDir, { recursive: true, force: true });
    return;
  }
  const output = testInfo.outputPath('video.mp4');
  try {
    await encodeScreenshotVideo(frames, framesDir, output, resolveScreenshotVideoOptions(artifacts.screenshotVideo), artifacts.ffmpegPath);
    await testInfo.attach('video', { path: output, contentType: 'video/mp4' });
    rmSync(framesDir, { recursive: true, force: true });
  } catch (cause) {
    console.warn(`[@wallets-e2e/core] Video not encoded; the frames are kept in ${framesDir}. ` +
      `FFmpeg with libx264 is needed (artifacts.ffmpegPath). ${describeCause(cause)}`);
  }
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

  // Narrow the recording to what the reader can act on.
  //
  // `videoScope: 'app'` keeps only the application: a wallet's screens are third-party UI
  // that behaves the same every run, and the assertions — not the footage — are what
  // prove a signature happened. Otherwise just drop the wallet's idle home page, which is
  // open throughout and shows nothing the approval windows do not.
  //
  // Either filter is skipped when it would leave nothing, so a wallet-only test still
  // records something.
  if (artifacts.videoScope === 'app') {
    const appSegments = segments.filter(({ source }) => roleOf(source.url) === 'dapp');
    if (appSegments.length > 0) {
      // One continuous span per page, not its active moments.
      //
      // The timeline splits a page into segments of activity so an idle wallet tab cannot
      // hide the app. Applied to the app itself that reasoning inverts: the waits — for a
      // receipt, for an approval, for the UI to settle — are part of the flow being shown,
      // and cutting them leaves disconnected fragments of a much longer run. Spanning each
      // page's first to last activity keeps the recording watchable as a sequence.
      const spans = new Map<TrackedVideo, VideoSegment<TrackedVideo>>();
      for (const segment of appSegments) {
        const existing = spans.get(segment.source);
        spans.set(segment.source, existing
          ? { source: segment.source, start: Math.min(existing.start, segment.start), end: Math.max(existing.end, segment.end) }
          : segment);
      }
      segments = [...spans.values()].sort((a, b) => a.start - b.start);
    }
  } else {
    const worthWatching = segments.filter(({ source }) => roleOf(source.url) !== 'wallet');
    if (worthWatching.length > 0) segments = worthWatching;
  }
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
