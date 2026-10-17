import { existsSync } from 'node:fs';
import { chromium, type BrowserContext } from '@playwright/test';

/** Options for the single persistent browser context every wallet-driving test run is built on. */
export interface LaunchContextOptions {
  /** Absolute path to the unpacked, built extension directory (its `manifest.json` parent). */
  extensionPath: string;
  /** Directory Chromium uses for its persistent profile. Defaults to a fresh temp dir if omitted. */
  userDataDir?: string;
  /**
   * Directory Playwright writes Chromium's own per-page recordings into. Omit it and Chromium
   * records nothing — which is the case for the package's default video source, see
   * `WalletArtifactOptions.videoSource`: those recordings are cropped once a wallet has opened a
   * second tab, so the default video is built from screenshots instead and this stays unset.
   */
  recordVideoDir?: string;
  /**
   * Size Chromium's recordings are made at (`recordVideo.size`). Left unset, each page records
   * at its own shape — a full app window and a wallet popup differ — and composition normalises
   * them. Only meaningful with `recordVideoDir`.
   */
  videoSize?: { width: number; height: number };
  /**
   * Chromium's window size (`--window-size`). Unset by default: a headless window is as large as
   * the page's viewport needs it to be, and a headed one takes the display's default.
   */
  windowSize?: { width: number; height: number };
  /**
   * The viewport every page in the context gets, the wallet's own pages included. Unset by
   * default, which is Playwright's 1280×720. A wallet's approval pages are pages of this context
   * too, so a viewport set here also changes which layout the extension renders.
   */
  viewport?: { width: number; height: number };
  /** Runs headed unless explicitly overridden. */
  headless?: boolean;
}

/** The Chromium command line `launchContext` builds; exported so it can be checked without a browser. */
export function launchArgs(options: Pick<LaunchContextOptions, 'extensionPath' | 'headless' | 'windowSize'>): string[] {
  const { extensionPath, headless = false, windowSize } = options;
  return [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    // Pin the device scale factor.
    //
    // `page.screenshot()` goes through CDP and comes out correct, while `recordVideo`
    // goes through the compositor. On a HiDPI display those disagree: the compositor
    // captures at the display's scale while the canvas is sized for CSS pixels, so the
    // page is magnified and only the part that fits is recorded — the rest is flat
    // background. Forcing 1 keeps both paths on the same pixel grid.
    '--force-device-scale-factor=1',
    '--high-dpi-support=1',
    ...(headless ? ['--headless=new'] : []),
    ...(windowSize ? [`--window-size=${windowSize.width},${windowSize.height}`] : []),
  ];
}

/**
 * Launches the one persistent Chromium context every test runs against, with the target extension
 * pre-loaded. Architecture rules: docs/core-design-notes.md
 *
 * On recordings: Chromium's `recordVideo` films the compositor surface, not the page. After a
 * wallet driver opens an approval as a second tab of the same window, that surface no longer
 * covers the app page's viewport, and every later frame shows the top-left of the page with flat
 * background beside it — while the page's own metrics still read the full viewport. Window and
 * viewport sizes do not fix that; `createExtensionTest` therefore records from screenshots by
 * default and only asks for `recordVideoDir` when `videoSource: 'chromium'` is chosen.
 */
export async function launchContext(options: LaunchContextOptions): Promise<BrowserContext> {
  const {
    extensionPath,
    userDataDir = '',
    recordVideoDir,
    headless = false,
    videoSize,
    windowSize,
    viewport,
  } = options;

  if (!existsSync(extensionPath)) {
    throw new Error(
      `[packages/core] Extension not found at "${extensionPath}". ` +
        `Build it first (see wallets/leather/scripts/build-extension.sh) before launching a context.`,
    );
  }

  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    args: launchArgs({ extensionPath, headless, windowSize }),
    deviceScaleFactor: 1,
    ...(viewport ? { viewport } : {}),
    ...(recordVideoDir
      ? { recordVideo: { dir: recordVideoDir, ...(videoSize ? { size: videoSize } : {}) } }
      : {}),
  });
}

/** Read from the live service worker: the ID only exists once Chromium has loaded the extension. */
export async function resolveExtensionId(context: BrowserContext): Promise<string> {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (!match) {
    throw new Error(`[packages/core] Could not resolve extension ID — unexpected service worker URL: "${worker.url()}"`);
  }
  return match[1];
}
