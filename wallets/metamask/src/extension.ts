import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The only MetaMask build this package's selectors are written against. */
export const METAMASK_VERSION = '13.13.1';

/** Points the driver at an unpacked extension of your own instead of the packaged one. */
export const METAMASK_EXTENSION_PATH_ENV = 'METAMASK_EXTENSION_PATH';

/** Printed when the extension is missing, and runnable as-is. */
export const METAMASK_PREPARE_COMMAND = 'npx wallets-e2e-metamask';

interface ExtensionScript {
  ensureExtension(dir?: string, log?: (message: string) => void): Promise<string>;
  downloadExtension(dir?: string, log?: (message: string) => void): Promise<string>;
}

/**
 * Walks up from this module to the package it was published in. Resolved at runtime rather than
 * written as a relative depth, because this file is imported both from `lib/src` (published) and
 * from `src` (this monorepo, and consumers running the TypeScript sources directly).
 */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === '@wallets-e2e/metamask') return dir;
      } catch {
        // Unreadable package.json: keep walking rather than guessing.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('[@wallets-e2e/metamask] Could not locate the package root.');
}

/**
 * Where the unpacked extension is, without touching the network: the `METAMASK_EXTENSION_PATH`
 * override when set, else the copy inside this package. Safe to call at module scope — the
 * directory does not have to exist yet.
 */
export function metamaskExtensionPath(): string {
  const override = process.env[METAMASK_EXTENSION_PATH_ENV]?.trim();
  return override ? override : join(packageRoot(), 'dist');
}

export function isMetamaskExtensionReady(dir = metamaskExtensionPath()): boolean {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return false;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')).version === METAMASK_VERSION;
  } catch {
    return false;
  }
}

async function extensionScript(): Promise<ExtensionScript> {
  const path = join(packageRoot(), 'scripts', 'extension.mjs');
  return (await import(pathToFileURL(path).href)) as ExtensionScript;
}

/**
 * Makes sure the pinned MetaMask build is unpacked, downloading it when it is not, and returns its
 * path. Idempotent and safe to call on every run.
 *
 * The install-time `postinstall` normally does this already; this is the fallback for the installs
 * where it could not run — `--ignore-scripts`, an offline or proxied CI, a restored cache.
 */
export async function ensureMetamaskExtension(dir = metamaskExtensionPath()): Promise<string> {
  if (isMetamaskExtensionReady(dir)) return dir;
  if (process.env[METAMASK_EXTENSION_PATH_ENV]?.trim()) {
    // An explicit override is the caller's own build. Downloading over it would discard it.
    throw new Error(
      `[@wallets-e2e/metamask] ${METAMASK_EXTENSION_PATH_ENV} points at "${dir}", which holds no ` +
        `MetaMask ${METAMASK_VERSION} build. Unset it to use the packaged extension.`,
    );
  }
  const { ensureExtension } = await extensionScript();
  return ensureExtension(dir);
}
