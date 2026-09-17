import { existsSync } from 'node:fs';
import { chromium, type BrowserContext } from '@playwright/test';

/** Options for the single persistent browser context every wallet-driving test run is built on. */
export interface LaunchContextOptions {
  /** Absolute path to the unpacked, built extension directory (its `manifest.json` parent). */
  extensionPath: string;
  /** Directory Chromium uses for its persistent profile. Defaults to a fresh temp dir if omitted. */
  userDataDir?: string;
  /** Directory Playwright writes recorded video(s) into. Omit it and the context records nothing. */
  recordVideoDir?: string;
  /**
   * Size recordings are made at. Left unset by default, and that default is deliberate.
   *
   * Pages in this context have very different shapes — a full app window and a wallet
   * approval popup — and a single `recordVideo.size` forces both into one frame, which
   * puts the smaller page in a corner of a too-large canvas rather than centring it.
   * Unset, Playwright records each page at its own aspect ratio and `composeVideo`
   * normalises every clip to one size with proper centring at composition time.
   *
   * Setting the context `viewport` is worse still: the wallet popup is a page here too,
   * and a desktop viewport changes which controls the extension renders.
   */
  videoSize?: { width: number; height: number };
  /** OS window size. Defaults to one that holds {@link LaunchContextOptions.viewport}. */
  windowSize?: { width: number; height: number };
  /**
   * Page viewport. Defaults to 1100x600, which a headed window fits on a 1280x720 display.
   *
   * Left at Playwright's own 1280x720 default the recording is split, because the window
   * cannot paint that much. Callers on a larger display can raise both this and
   * `windowSize` together — they must agree, or the split comes back.
   */
  viewport?: { width: number; height: number };
  /** Runs headed unless explicitly overridden. */
  headless?: boolean;
}

/**
 * No viewport or window size is imposed here, and that is deliberate.
 *
 * Chromium's capture surface, not the viewport, decides how much of a page reaches a
 * recording. Pinning a viewport or a window size makes the two disagree: the page paints
 * its own width while the canvas stays the size Playwright derived, and the difference
 * records as flat background — a picture split down the side. Playwright's own defaults
 * keep them in step. Callers who genuinely need a size can still pass `viewport`.
 */

/**
 * Launches the one persistent Chromium context every test runs against, with the target extension
 * pre-loaded. Architecture rules: docs/core-design-notes.md
 */
export async function launchContext(options: LaunchContextOptions): Promise<BrowserContext> {
  const {
    extensionPath,
    userDataDir = '',
    recordVideoDir,
    headless = false,
    videoSize,
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
    args: [
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
    ],
    deviceScaleFactor: 1,
    // No `size` unless a caller insists: each page records at its own shape and
    // composition normalises them. See `videoSize` above for why forcing one is wrong.
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
    throw new Error(
      `[packages/core] Could not resolve extension ID — unexpected service worker URL: "${worker.url()}"`,
    );
  }
  return match[1];
}
