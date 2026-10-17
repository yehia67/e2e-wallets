// Type-only import: a value import here would pull the Playwright runner into `node --test`.
import type { PlaywrightTestConfig } from '@playwright/test';

export type ArtifactMode = 'on' | 'off' | 'only-on-failure' | 'retain-on-failure';

/**
 * Where the test's video comes from.
 *
 * `'screenshots'` (the default) photographs the page in use every few hundred milliseconds
 * through CDP and encodes the frames with FFmpeg into an H.264 mp4. `'chromium'` is Playwright's
 * `recordVideo`, composed per page by the package.
 *
 * The default is not Chromium's recorder because of what it records. It films the compositor
 * surface, and once a wallet driver has opened an approval as a second tab of the same window
 * (`context.newPage()` + `goto('chrome-extension://…/notification.html')`, which is how MetaMask
 * approvals are reached) that surface stops covering the app page's viewport: every later frame
 * holds the top-left ~80% of the page with flat background beside it, and the right edge of each
 * screen is missing. The page's own metrics — `Page.getLayoutMetrics`, `Browser.getWindowBounds`,
 * `window.innerWidth` — still report the full viewport throughout; resizing the window or
 * re-applying the viewport does not restore the surface, and the per-page recordings are already
 * cropped before any composition. `page.screenshot()` is always the full viewport.
 */
export type VideoSource = 'screenshots' | 'chromium';

export const DEFAULT_VIDEO_SOURCE: VideoSource = 'screenshots';

/** Tuning for `videoSource: 'screenshots'`. */
export interface ScreenshotVideoOptions {
  /** Milliseconds between frames. Default 200 (5 frames a second); raise it on pages that are slow to paint. */
  intervalMs?: number;
  /** JPEG quality of each frame, 1–100. Default 90. */
  quality?: number;
  /** Frame rate of the encoded video. Default 25. */
  fps?: number;
  /** libx264 constant rate factor; lower is larger and sharper. Default 20. */
  crf?: number;
  /** How long the last frame is held, so the end state can be read. Default 1500. */
  tailMs?: number;
}

export const DEFAULT_SCREENSHOT_VIDEO = {
  intervalMs: 200,
  quality: 90,
  fps: 25,
  crf: 20,
  tailMs: 1_500,
} as const satisfies Required<ScreenshotVideoOptions>;

export function resolveScreenshotVideoOptions(
  options: ScreenshotVideoOptions = {},
): Required<ScreenshotVideoOptions> {
  const resolved: Required<ScreenshotVideoOptions> = { ...DEFAULT_SCREENSHOT_VIDEO };
  for (const key of Object.keys(DEFAULT_SCREENSHOT_VIDEO) as (keyof ScreenshotVideoOptions)[]) {
    const value = options[key];
    if (value !== undefined) resolved[key] = value;
  }
  return resolved;
}

/**
 * The source actually used: the requested one, unless screenshots were asked for and FFmpeg is
 * not there to encode them, in which case Chromium's recorder keeps a video coming.
 */
export function resolveVideoSource(
  requested: VideoSource | undefined,
  ffmpegAvailable: boolean,
): { source: VideoSource; fallback: boolean } {
  const wanted = requested ?? DEFAULT_VIDEO_SOURCE;
  if (wanted === 'screenshots' && !ffmpegAvailable) return { source: 'chromium', fallback: true };
  return { source: wanted, fallback: false };
}

/** Retention of the `page-logs` attachment (console errors and warnings, page errors). */
export const DEFAULT_PAGE_LOGS_MODE: ArtifactMode = 'retain-on-failure';

// Trace stays Playwright's: a project's `use.trace` always beats a fixture-supplied value, so a
// knob here could not win. Video and screenshots are the package's, because Playwright captures
// every page in the context — including a wallet's invisible worker pages — and does it the moment
// the test body ends, which is too early for a fixture to filter.
export interface WalletArtifactOptions {
  video?: ArtifactMode;
  screenshot?: ArtifactMode;
  /** See `VideoSource`. Default `'screenshots'`. */
  videoSource?: VideoSource;
  /** Frame interval, quality and encoder settings for `videoSource: 'screenshots'`. */
  screenshotVideo?: ScreenshotVideoOptions;
  /**
   * Retention of the `page-logs` attachment: the console errors and warnings and the uncaught
   * errors of every page, so a click that never reached the wallet can say why. Default
   * `'retain-on-failure'`; `WALLETS_E2E_DEBUG=1` echoes every message as it happens.
   */
  pageLogs?: ArtifactMode;
  /**
   * One chronological app/wallet video (default), or Playwright's separate page videos.
   * `videoSource: 'chromium'` only: a screenshot video is one recording by construction.
   */
  videoLayout?: 'combined' | 'separate';
  /**
   * Which pages the combined video shows. `'app'` keeps only the application under test;
   * `'all'` (the default) also includes the wallet's approval windows.
   *
   * A wallet's own screens are third-party UI behaving identically every run, and whether
   * a signature happened is proved by the assertions, not by footage of it. `'app'` leaves
   * the recording as a record of what the application did — which is the part a reviewer
   * wrote and can act on.
   */
  videoScope?: 'app' | 'all';
  /** FFmpeg executable, for encoding screenshot videos and composing Chromium's. Defaults to `ffmpeg` on PATH. */
  ffmpegPath?: string;
  /**
   * In separate mode, attach the wallet's home-page recording too. Off by default: that page is
   * open for the whole run and idle for nearly all of it, while the approval
   * windows already hold everything the wallet did. `videoSource: 'chromium'` only.
   */
  walletHomeVideo?: boolean;
}

export const DEFAULT_ARTIFACT_MODES = {
  video: 'on',
  screenshot: 'on',
  trace: 'retain-on-failure',
} as const satisfies Record<'video' | 'screenshot' | 'trace', ArtifactMode>;

/** Where `withWalletReporting` stashes a caller's `use.screenshot`, since it turns the real one off. */
export const WALLET_SCREENSHOT_USE_KEY = 'walletScreenshot';

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

export function resolveArtifactMode(
  explicit: ArtifactMode | undefined,
  fromProjectUse: unknown,
  fallback: ArtifactMode,
): ArtifactMode {
  return normalizeArtifactMode(explicit) ?? normalizeArtifactMode(fromProjectUse) ?? fallback;
}

// Compares against `expectedStatus`, not the literal 'passed': a test.fail()-marked test that
// failed did exactly what it was told to and is not a failure worth an artifact.
export function shouldRetainArtifact(
  mode: ArtifactMode,
  status: string | undefined,
  expectedStatus: string | undefined,
): boolean {
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return status !== expectedStatus;
}

export function walletReporters(
  options: { outputFolder?: string; open?: 'never' | 'on-failure' | 'always' } = {},
): PlaywrightTestConfig['reporter'] {
  const { outputFolder = 'playwright-report', open = 'never' } = options;
  return [
    ['list'],
    ['html', { outputFolder, open }],
  ];
}

export function withWalletReporting<T extends PlaywrightTestConfig>(
  config: T,
): T & Required<Pick<PlaywrightTestConfig, 'reporter' | 'use'>> {
  const use: Record<string, unknown> = { ...(config.use ?? {}) };
  for (const [key, mode] of Object.entries(DEFAULT_ARTIFACT_MODES)) {
    if (use[key] === undefined) use[key] = mode;
  }

  // Playwright's own screenshots would duplicate the fixture's, and it captures every page in the
  // context — a wallet's invisible worker pages included — the moment the test body ends, too early
  // for a fixture to filter. The caller's intent is carried over to the fixture's own capture.
  if (use.screenshot !== undefined && use[WALLET_SCREENSHOT_USE_KEY] === undefined) {
    use[WALLET_SCREENSHOT_USE_KEY] = use.screenshot;
  }
  use.screenshot = 'off';

  return {
    ...config,
    reporter: config.reporter ?? walletReporters(),
    use,
  } as T & Required<Pick<PlaywrightTestConfig, 'reporter' | 'use'>>;
}
