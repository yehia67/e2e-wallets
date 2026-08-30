#!/usr/bin/env node
/**
 * Generate or migrate a local E2E fixture wallet.
 * Writes secrets to wallets/metamask/.env.local (gitignored) — never commit that file.
 *
 * **If you already funded an address, do NOT run without reading this:**
 * - Default: preserves existing .env.local (same seed + address).
 * - Only adds WALLETS_E2E_ETH_PRIVATE_KEY if missing (derived from existing seed).
 * - `--force`: creates a NEW random wallet (new address — you must fund again).
 *
 * Usage (from repo root):
 *   node wallets/metamask/scripts/generate-fixture-wallet.mjs
 *   node wallets/metamask/scripts/generate-fixture-wallet.mjs --force
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(scriptDir, '..', '.env.local');
const force = process.argv.includes('--force');

const workDir = join(tmpdir(), `wallets-e2e-metamask-gen-${process.pid}`);
execSync(`mkdir -p "${workDir}" && cd "${workDir}" && npm init -y >/dev/null 2>&1 && npm install ethers@6 --silent`, {
  stdio: 'pipe',
});
const { Wallet } = await import(join(workDir, 'node_modules/ethers/lib.esm/index.js'));

function parseEnvFile(content) {
  const out = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function formatEnvFile(env) {
  const lines = ['# Generated locally — DO NOT COMMIT', '# Re-running generate without --force keeps the same funded address.'];
  if (env.WALLETS_E2E_SEED_PHRASE) {
    lines.push(`WALLETS_E2E_SEED_PHRASE="${env.WALLETS_E2E_SEED_PHRASE}"`);
  }
  if (env.WALLETS_E2E_ETH_ADDRESS) {
    lines.push(`WALLETS_E2E_ETH_ADDRESS=${env.WALLETS_E2E_ETH_ADDRESS}`);
  }
  if (env.WALLETS_E2E_ETH_PRIVATE_KEY) {
    lines.push(`WALLETS_E2E_ETH_PRIVATE_KEY=${env.WALLETS_E2E_ETH_PRIVATE_KEY}`);
  }
  if (env.WALLETS_E2E_PASSWORD) {
    lines.push(`WALLETS_E2E_PASSWORD="${env.WALLETS_E2E_PASSWORD}"`);
  }
  lines.push('');
  return lines.join('\n');
}

if (existsSync(envPath) && !force) {
  const env = parseEnvFile(readFileSync(envPath, 'utf8'));
  if (!env.WALLETS_E2E_ETH_PRIVATE_KEY && env.WALLETS_E2E_SEED_PHRASE) {
    const w = Wallet.fromPhrase(env.WALLETS_E2E_SEED_PHRASE.trim());
    env.WALLETS_E2E_ETH_PRIVATE_KEY = w.privateKey;
    if (!env.WALLETS_E2E_ETH_ADDRESS) {
      env.WALLETS_E2E_ETH_ADDRESS = w.address;
    }
    writeFileSync(envPath, formatEnvFile(env), { mode: 0o600 });
    console.log('Added WALLETS_E2E_ETH_PRIVATE_KEY to existing .env.local — same address preserved.');
  }
  console.log('Existing Sepolia funding address (unchanged):');
  console.log(env.WALLETS_E2E_ETH_ADDRESS ?? '(set WALLETS_E2E_ETH_ADDRESS in .env.local)');
  console.log('');
  console.log(`Secrets file: ${envPath}`);
  console.log('To create a NEW wallet (new address — fund again), run with --force');
  process.exit(0);
}

const w = Wallet.createRandom();
const password = `E2E-MetaMask-${randomBytes(4).toString('hex')}!9`;

writeFileSync(
  envPath,
  formatEnvFile({
    WALLETS_E2E_SEED_PHRASE: w.mnemonic.phrase,
    WALLETS_E2E_ETH_ADDRESS: w.address,
    WALLETS_E2E_ETH_PRIVATE_KEY: w.privateKey,
    WALLETS_E2E_PASSWORD: password,
  }),
  { mode: 0o600 },
);

console.log('New Sepolia funding address (send test ETH here):');
console.log(w.address);
console.log('');
console.log(`Secrets written to: ${envPath}`);
console.log('Tests load this file automatically via wallets/metamask/fixtures/wallet.ts — do NOT bash `source` it.');
