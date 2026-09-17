/**
 * Fetches and verifies the pinned, official MetaMask production build this package drives.
 *
 * Plain JavaScript with no dependencies, because it runs in three places where the package's own
 * compiled output may not exist yet: a consumer's `postinstall`, the `wallets-e2e-metamask` bin,
 * and this monorepo's `build:extension`.
 *
 * MetaMask's own `build:test` CI artifact is deliberately not used: it falls back to an all-zero
 * Infura project id, so built-in networks render while every real RPC call fails with 401, and a
 * moving artifact would change the driver's selectors without a release in this repo.
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const METAMASK_VERSION = '13.13.1';

/** Set to point every consumer at an unpacked extension of their own. */
export const EXTENSION_PATH_ENV = 'METAMASK_EXTENSION_PATH';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Where the extension lives: an explicit override, else inside this package, so a consumer's
 * repository never has to hold a copy or a download script of its own.
 */
export function extensionDir() {
  const override = process.env[EXTENSION_PATH_ENV]?.trim();
  return override ? override : join(packageRoot, 'dist');
}

/** The version actually unpacked at `dir`, or null when nothing usable is there. */
export function installedVersion(dir = extensionDir()) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

export function isExtensionReady(dir = extensionDir()) {
  return installedVersion(dir) === METAMASK_VERSION;
}

/**
 * Downloads and unpacks the pinned release into `dir`, replacing whatever is there.
 *
 * A stale or partial artifact is removed rather than kept, so a run can never silently exercise a
 * different MetaMask UI than the one the driver's selectors were written against.
 */
export async function downloadExtension(dir = extensionDir(), log = console.error) {
  const archiveName = `metamask-chrome-${METAMASK_VERSION}.zip`;
  const archiveUrl = `https://github.com/MetaMask/metamask-extension/releases/download/v${METAMASK_VERSION}/${archiveName}`;
  // Staged in a temp directory, not beside the target: the target may be inside a consumer's
  // node_modules, and a half-written archive must never be left there.
  const stagingDir = mkdtempSync(join(tmpdir(), 'wallets-e2e-metamask-'));
  const zipPath = join(stagingDir, archiveName);

  log(`[wallets-e2e/metamask] Fetching pinned MetaMask ${METAMASK_VERSION}`);
  const response = await fetch(archiveUrl, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${archiveUrl}`);
  }

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', dir], { stdio: 'inherit' });
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }

  const found = installedVersion(dir);
  if (found !== METAMASK_VERSION) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Unexpected MetaMask version ${String(found)}; expected ${METAMASK_VERSION}.`);
  }

  log(`[wallets-e2e/metamask] MetaMask ${METAMASK_VERSION} ready at ${dir}`);
  return dir;
}

/** Idempotent: downloads only when the pinned version is not already unpacked at `dir`. */
export async function ensureExtension(dir = extensionDir(), log = console.error) {
  if (isExtensionReady(dir)) {
    log(`[wallets-e2e/metamask] MetaMask ${METAMASK_VERSION} already at ${dir}`);
    return dir;
  }
  return downloadExtension(dir, log);
}
