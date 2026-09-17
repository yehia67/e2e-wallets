import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Searched from the test project upwards, in this order, first hit wins per key.
 *
 * Without this, a client had to wrap the server in a shell script that sourced the secrets before
 * `exec`ing it — a script per repository, holding the one thing that must not end up in an MCP
 * client's config file or its logs.
 */
export const ENV_FILE_NAMES = ['.env.wallet-e2e.local', '.env.wallet-e2e', '.env.local'];

const MAX_PARENTS = 4;

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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in parsed)) parsed[key] = value;
  }
  return parsed;
}

/** The env files that apply to a project, nearest first. */
export function findEnvFiles(projectDir: string): string[] {
  let dir = projectDir;
  const found: string[] = [];
  for (let i = 0; i <= MAX_PARENTS; i++) {
    for (const name of ENV_FILE_NAMES) {
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
 * Values to hand the test runner. Unreadable files are skipped rather than failing a run, and the
 * server's own environment always wins, so an operator can still override a checked-in default.
 */
export function loadProjectEnv(projectDir: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const loaded: Record<string, string> = {};
  for (const path of findEnvFiles(projectDir)) {
    let parsed: Record<string, string>;
    try {
      parsed = parseEnvFile(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (key in loaded || base[key] !== undefined) continue;
      loaded[key] = value;
    }
  }
  return loaded;
}
