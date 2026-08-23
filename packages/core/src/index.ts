import { existsSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

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
  /** Directory Playwright should write the recorded video(s) into. Video recording is always on. */
  recordVideoDir: string;
  /** Runs headed unless explicitly overridden. v1 is scoped to headed execution (AD-6). */
  headless?: boolean;
}

/**
 * Launches the one persistent Chromium context every test in this monorepo runs against, with
 * the target extension pre-loaded and video recording enabled.
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
    recordVideo: { dir: recordVideoDir },
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

/** An unlocked wallet account, as reported by a `WalletDriver` after import/unlock. */
export interface WalletAccount {
  address: string;
}

/**
 * The port every wallet adapter in this monorepo implements (Ports & Adapters paradigm; AD-2).
 * Test code calls these methods directly and never touches raw `Page`/`BrowserContext` popup
 * logic itself — that's each adapter's job to encapsulate.
 *
 * Story 1.1 implements only `importWallet`. `connectToDapp`/`confirmTransaction` are typed stubs
 * here so Stories 1.2/1.3 implement against a stable, already-agreed contract.
 */
export interface WalletDriver {
  /** Imports a wallet from a seed phrase into the loaded, unlocked extension. */
  importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount>;
  /** Story 1.2 — approves a dApp connection request that opens in the extension's popup. */
  connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
  /** Story 1.3 — approves a transaction-signing request that opens in the extension's popup. */
  confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
}

export type { BrowserContext, Page };
