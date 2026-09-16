// Type-only import: a value import here would pull the Playwright runner into `node --test`.
import type { PlaywrightTestConfig } from '@playwright/test';

export type ArtifactMode = 'on' | 'off' | 'only-on-failure' | 'retain-on-failure';

// Trace stays Playwright's: a project's `use.trace` always beats a fixture-supplied value, so a
// knob here could not win. Video and screenshots are the package's, because Playwright captures
// every page in the context — including a wallet's invisible worker pages — and does it the moment
// the test body ends, which is too early for a fixture to filter.
export interface WalletArtifactOptions {
  video?: ArtifactMode;
  screenshot?: ArtifactMode;
  /** One chronological app/wallet video (default), or Playwright's separate page videos. */
  videoLayout?: 'combined' | 'separate';
  /** FFmpeg executable for combined videos. Defaults to `ffmpeg` on PATH. */
  ffmpegPath?: string;
  /**
   * In separate mode, attach the wallet's home-page recording too. Off by default: that page is
   * open for the whole run and idle for nearly all of it, while the approval
   * windows already hold everything the wallet did.
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
