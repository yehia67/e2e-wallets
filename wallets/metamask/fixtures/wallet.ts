import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Searched from the test file upwards, in this order, so a repository that keeps wallet secrets out
 * of its app's own `.env.local` does not need a `--env-file` flag or a wrapper script to run a suite.
 */
const ENV_FILE_NAMES = ['.env.wallet-e2e.local', '.env.wallet-e2e', '.env.local'];

function loadEnvLocalIfNeeded(): void {
  let dir = process.cwd();
  const envPaths: string[] = [];
  for (let i = 0; i < 4; i++) {
    for (const name of ENV_FILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) envPaths.push(candidate);
    }
    if (envPaths.length > 0) break;
    dir = dirname(dir);
  }
  for (const envPath of envPaths) loadEnvFile(envPath);
}

function loadEnvFile(envPath: string): void {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim().replace(/^export\s+/, '');
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
      `[wallets/metamask] ${name} is not set. Generate a throwaway wallet and export ` +
        `WALLETS_E2E_SEED_PHRASE, WALLETS_E2E_ETH_ADDRESS and WALLETS_E2E_PASSWORD ` +
        `(a .env.wallet-e2e.local or .env.local beside your tests is auto-loaded).`,
    );
  }
  return value;
}

/**
 * Getters, not values: `src/onboarding.ts` imports this module, so eager reads would make
 * `import '@wallets-e2e/metamask'` throw for any consumer without the env set — before a test runs.
 */
export const wallet = {
  get seedPhrase(): string {
    return requireEnv('WALLETS_E2E_SEED_PHRASE');
  },
  get address(): string {
    return requireEnv('WALLETS_E2E_ETH_ADDRESS');
  },
  get password(): string {
    return requireEnv('WALLETS_E2E_PASSWORD');
  },
};
