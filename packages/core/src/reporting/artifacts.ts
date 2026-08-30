// Type-only import: a value import here would pull the Playwright runner into `node --test`.
import type { PlaywrightTestConfig } from '@playwright/test';

export type ArtifactMode = 'on' | 'off' | 'only-on-failure' | 'retain-on-failure';

// Video only: Playwright itself owns trace and screenshots for these contexts, and a project's
// `use` block always beats a fixture-supplied value, so a trace/screenshot knob here could not win.
export interface WalletArtifactOptions {
  video?: ArtifactMode;
}

export const DEFAULT_ARTIFACT_MODES = {
  video: 'on',
  screenshot: 'on',
  trace: 'retain-on-failure',
} as const satisfies Record<'video' | 'screenshot' | 'trace', ArtifactMode>;

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

  return {
    ...config,
    reporter: config.reporter ?? walletReporters(),
    use,
  } as T & Required<Pick<PlaywrightTestConfig, 'reporter' | 'use'>>;
}
