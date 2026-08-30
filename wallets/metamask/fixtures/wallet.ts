import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
