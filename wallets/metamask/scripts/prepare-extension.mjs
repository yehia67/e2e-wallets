#!/usr/bin/env node
/**
 * CLI around `extension.mjs`, used as this package's `postinstall`, as the `wallets-e2e-metamask`
 * bin, and as the monorepo's `build:extension`.
 *
 * Usage: wallets-e2e-metamask [prepare] [--force] [--optional] [--dir <path>]
 *
 * `--optional` never fails the caller: an install behind a proxy, offline, or without `unzip` still
 * succeeds, and the download is retried lazily on the first test run instead.
 */
import { downloadExtension, ensureExtension, extensionDir, METAMASK_VERSION } from './extension.mjs';

const argv = process.argv.slice(2).filter((arg) => arg !== 'prepare');
const force = argv.includes('--force');
const optional = argv.includes('--optional');
const dirFlag = argv.indexOf('--dir');
const dir = dirFlag === -1 ? extensionDir() : argv[dirFlag + 1];

if (!dir) {
  console.error('[wallets-e2e/metamask] --dir needs a path.');
  process.exit(1);
}

try {
  await (force ? downloadExtension(dir) : ensureExtension(dir));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (optional) {
    console.error(
      `[wallets-e2e/metamask] Could not prepare MetaMask ${METAMASK_VERSION} now (${message}). ` +
        `It will be downloaded on the first test run, or run \`npx wallets-e2e-metamask\` yourself.`,
    );
    process.exit(0);
  }
  console.error(`[wallets-e2e/metamask] ERROR: ${message}`);
  process.exit(1);
}
