#!/usr/bin/env node
/**
 * Download MetaMask's official test build (chrome) from CI artifacts — no yarn install
 * in metamask/metamask-extension required. Mirrors `.devcontainer/download-builds.ts`.
 *
 * Usage: node wallets/metamask/scripts/download-test-build.mjs <output-dir>
 */
import { execSync } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(scriptDir, '..', 'dist');
const CLOUDFRONT = process.env.AWS_CLOUDFRONT_URL ?? 'https://diuv6g5fj9pvx.cloudfront.net';
const OWNER = 'MetaMask';
const REPO = 'metamask-extension';
const WORKFLOW = 'main.yml';

async function githubJson(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wallets-e2e-metamask-build' },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} → ${res.status}`);
  return res.json();
}

async function main() {
  const runs = await githubJson(
    `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?branch=main&status=success&per_page=1`,
  );
  const run = runs.workflow_runs?.[0];
  if (!run) throw new Error('No successful MetaMask CI run found on main');

  const pkgRes = await fetch(
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/${run.head_sha}/package.json`,
  );
  if (!pkgRes.ok) throw new Error(`Could not fetch package.json for ${run.head_sha}`);
  const { version } = await pkgRes.json();

  const hostUrl = `${CLOUDFRONT}/${REPO}/${run.id}`;
  const zipUrl = `${hostUrl}/build-test-webpack/builds/metamask-chrome-${version}.zip`;
  console.log(`[download-test-build] Run ${run.id}, version ${version}`);
  console.log(`[download-test-build] Fetching ${zipUrl}`);

  const zipRes = await fetch(zipUrl);
  if (!zipRes.ok) throw new Error(`Download failed: ${zipRes.status} ${zipUrl}`);

  // Use unzip via system command — Node has no built-in zip extract without deps.
  const tmpZip = join(outDir, '..', `.metamask-chrome-${run.id}.zip`);
  mkdirSync(dirname(tmpZip), { recursive: true });
  await pipeline(Readable.fromWeb(zipRes.body), createWriteStream(tmpZip));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execSync(`unzip -q -o "${tmpZip}" -d "${outDir}"`, { stdio: 'inherit' });
  rmSync(tmpZip, { force: true });

  console.log(`[download-test-build] Extracted to ${outDir}`);
}

main().catch((err) => {
  console.error('[download-test-build] ERROR:', err.message ?? err);
  process.exit(1);
});
