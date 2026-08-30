#!/usr/bin/env node
/**
 * Download the pinned, official MetaMask production build used by Synpress.
 *
 * The old implementation followed MetaMask's latest successful CI run and downloaded its
 * `build:test` artifact. Those artifacts deliberately fall back to an all-zero Infura project
 * id, so built-in Sepolia can render in the picker while every real RPC call fails with 401.
 * A moving CI artifact also makes the driver's selectors change without a release in this repo.
 *
 * Usage: node wallets/metamask/scripts/download-test-build.mjs <output-dir>
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const METAMASK_VERSION = '13.13.1';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(scriptDir, '..', 'dist');
const archiveName = `metamask-chrome-${METAMASK_VERSION}.zip`;
const archiveUrl =
  `https://github.com/MetaMask/metamask-extension/releases/download/v${METAMASK_VERSION}/${archiveName}`;

async function main() {
  const zipPath = join(outDir, '..', `.${archiveName}`);
  console.log(`[download-metamask] Fetching pinned production release ${METAMASK_VERSION}`);

  const response = await fetch(archiveUrl, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${archiveUrl}`);
  }

  mkdirSync(dirname(zipPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', outDir], { stdio: 'inherit' });
  rmSync(zipPath, { force: true });

  const manifestPath = join(outDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== METAMASK_VERSION) {
    rmSync(outDir, { recursive: true, force: true });
    throw new Error(
      `Unexpected MetaMask version ${String(manifest.version)}; expected ${METAMASK_VERSION}.`,
    );
  }

  console.log(`[download-metamask] Extracted and verified MetaMask ${METAMASK_VERSION} at ${outDir}`);
}

main().catch((error) => {
  console.error('[download-metamask] ERROR:', error?.message ?? error);
  process.exit(1);
});
