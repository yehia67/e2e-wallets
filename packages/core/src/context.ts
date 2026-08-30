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
  /** Runs headed unless explicitly overridden. */
  headless?: boolean;
}

/**
 * Launches the one persistent Chromium context every test runs against, with the target extension
 * pre-loaded. Architecture rules: docs/core-design-notes.md
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
