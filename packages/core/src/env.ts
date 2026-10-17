// Node built-ins only: `node --test` runs this straight from source.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Searched from the working directory upwards, in this order, so a repository that keeps wallet
 * secrets out of its app's own `.env.local` needs neither a `--env-file` flag nor a wrapper script.
 */
export const WALLET_ENV_FILE_NAMES = ['.env.wallet-e2e.local', '.env.wallet-e2e', '.env.local'] as const;

/**
 * Parses dotenv-style text: `KEY=value`, optional `export`, single or double quotes, `#` comments.
 * A key's first occurrence wins. A key with an empty value is left out: an empty line in a file
 * means "not set here", and must not shadow a value a parent file or the environment carries.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim().replace(/^export\s+/, '');
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (value === '') continue;
    if (!(key in parsed)) parsed[key] = value;
  }
  return parsed;
}

/** The env files that apply, nearest first; the search stops at the first directory that has any. */
export function findEnvFiles(
  startDir: string,
  names: readonly string[] = WALLET_ENV_FILE_NAMES,
  maxParents = 4,
): string[] {
  let dir = startDir;
  const found: string[] = [];
  for (let i = 0; i <= maxParents; i++) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) found.push(candidate);
    }
    if (found.length > 0) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found;
}

/**
 * Loads the wallet env files into `env` (the process environment by default) and returns the
 * files applied. A variable the environment already carries is never overwritten, even when it
 * is empty: an operator who exported `WALLETS_E2E_X=` on the command line meant "unset", and a
 * file must not quietly fill it in behind their back. Unreadable files are skipped.
 */
export function loadEnvFiles(
  options: { cwd?: string; names?: readonly string[]; env?: NodeJS.ProcessEnv } = {},
): string[] {
  const { cwd = process.cwd(), names = WALLET_ENV_FILE_NAMES, env = process.env } = options;
  const applied: string[] = [];
  for (const path of findEnvFiles(cwd, names)) {
    let parsed: Record<string, string>;
    try {
      parsed = parseEnvFile(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    applied.push(path);
    for (const [key, value] of Object.entries(parsed)) {
      if (key in env) continue;
      env[key] = value;
    }
  }
  return applied;
}

/** A variable a spec cannot run without. Throws a sentence naming it, with `hint` on how to set it. */
export function requiredEnv(name: string, hint?: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[@wallets-e2e/core] ${name} is not set.${hint ? ` ${hint}` : ''}`);
  }
  return value;
}

/** A variable a spec can do without. Empty and whitespace count as unset. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/**
 * Whether the suite may spend real gas. Specs gate every write behind this and skip otherwise,
 * so a plain `playwright test` never sends a transaction by accident. The flag is `=1`, nothing
 * else, so a stray `true` or `yes` does not spend either.
 */
export function liveWritesEnabled(flagName = 'WALLETS_E2E_LIVE_WRITES'): boolean {
  return process.env[flagName] === '1';
}
