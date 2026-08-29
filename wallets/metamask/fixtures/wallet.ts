import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Parse wallets/metamask/.env.local when env vars are not already exported (seed phrases contain spaces). */
function loadEnvLocalIfNeeded(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  let envPath: string | null = null;
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, '.env.local');
    if (existsSync(candidate)) {
      envPath = candidate;
      break;
    }
    dir = dirname(dir);
  }
  if (!envPath) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
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
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocalIfNeeded();

/**
 * MetaMask E2E fixture wallet — env-var only (NFR1 / AD-5).
 *
 * Unlike Leather's fixture, there is NO checked-in default seed phrase. Set all three vars
 * locally (e.g. via `node wallets/metamask/scripts/generate-fixture-wallet.mjs`) before running
 * browser suites. If `WALLETS_E2E_SEED_PHRASE` is unset, importing this module throws immediately
 * — before Playwright launches a browser.
 *
 * `.env.local` is parsed automatically when present (seed phrases contain spaces — do not
 * `source` that file in bash without quoting).
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[wallets/metamask] ${name} is not set. ` +
        `Run: node wallets/metamask/scripts/generate-fixture-wallet.mjs ` +
        `then export WALLETS_E2E_* vars (or rely on auto-loaded .env.local)`,
    );
  }
  return value;
}

export const wallet = {
  seedPhrase: requireEnv('WALLETS_E2E_SEED_PHRASE'),
  address: requireEnv('WALLETS_E2E_ETH_ADDRESS'),
  password: requireEnv('WALLETS_E2E_PASSWORD'),
};
