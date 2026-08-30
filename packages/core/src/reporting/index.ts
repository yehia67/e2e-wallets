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
  resolveArtifactMode,
  shouldRetainArtifact,
  type ArtifactMode,
  type WalletArtifactOptions,
} from './artifacts.js';
import { orderVideoEntriesForAttachment } from './video-order.js';

export * from './artifacts.js';

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
  /** Video override, winning over the project's `use`. Trace and screenshots are configured the
   * ordinary Playwright way, through `use.trace` and `use.screenshot`. */
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
    screenshot: [DEFAULT_ARTIFACT_MODES.screenshot, { option: true, scope: 'worker', box: true }],

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
        const videos = trackVideos(context);

        try {
          await use(context);
        } finally {
          // Order is load-bearing: closing flushes the video and lets Playwright take its own artifacts.
          try {
            await context.close();
          } catch {
            // A crashed browser can reject close(); attachVideos must still run.
          }
          await attachVideos(videos, videoDir, testInfo, videoMode);
        }
      } finally {
        rmSync(userDataDir, { recursive: true, force: true });
      }
    },

    page: async (
      { context }: { context: BrowserContext },
      use: (page: Page) => Promise<void>,
    ) => {
      const page = await context.newPage();
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

interface TrackedVideo {
  video: Video;
  url: string;
}

/** Collected before `context.close()` — `context.pages()` is empty afterwards, but `video.path()` only resolves after close. */
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
        // Already gone, or never written.
      }
      return;
    }
    // First attachment is named exactly `video` so the HTML reporter renders it as a player.
    await testInfo.attach(index === 1 ? 'video' : `video-${index}`, {
      path,
      contentType: 'video/webm',
    });
  };

  try {
    for (const entry of orderVideoEntriesForAttachment(tracked)) {
      let path: string | undefined;
      try {
        path = await entry.video.path();
      } catch {
        continue;
      }
      if (path) await take(path);
    }

    // Directory scanned as a fallback: popups can close before the `page` event bookkeeping sees them.
    if (existsSync(videoDir)) {
      for (const file of readdirSync(videoDir)) {
        if (file.endsWith('.webm')) await take(join(videoDir, file));
      }
    }
  } catch {
    // Artifact collection must never mask the test's real failure.
  }
}
