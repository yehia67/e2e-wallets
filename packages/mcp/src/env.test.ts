import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { findEnvFiles, loadProjectEnv, parseEnvFile } from './env.ts';

function tempProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'wallets-e2e-mcp-env-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

describe('parseEnvFile', () => {
  it('reads plain, quoted, exported and value-with-= lines, and skips comments', () => {
    const parsed = parseEnvFile(
      ['# comment', 'PLAIN=one', 'QUOTED="two"', "SINGLE='three'", 'export EXPORTED=four', 'URL=https://x/y?a=b', '', 'NOEQ'].join('\n'),
    );
    assert.deepEqual(parsed, {
      PLAIN: 'one',
      QUOTED: 'two',
      SINGLE: 'three',
      EXPORTED: 'four',
      URL: 'https://x/y?a=b',
    });
  });
});

describe('findEnvFiles', () => {
  it('prefers the wallet-specific file over a generic .env.local in the same directory', () => {
    const root = tempProject({ '.env.wallet-e2e.local': 'A=1\n', '.env.local': 'A=2\n' });
    try {
      assert.deepEqual(
        findEnvFiles(root).map((path) => path.slice(root.length + 1)),
        ['.env.wallet-e2e.local', '.env.local'],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('walks up to a parent when the project directory holds none', () => {
    const root = tempProject({ '.env.wallet-e2e.local': 'A=1\n', 'dapp/playwright.config.ts': '' });
    try {
      assert.deepEqual(findEnvFiles(join(root, 'dapp')), [join(root, '.env.wallet-e2e.local')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('loadProjectEnv', () => {
  it('lets the nearest file win, and never overrides the server process env', () => {
    const root = tempProject({
      '.env.wallet-e2e.local': 'SEED=from-wallet-file\nSHARED=wallet\n',
      '.env.local': 'SHARED=generic\nONLY_GENERIC=yes\n',
    });
    try {
      const loaded = loadProjectEnv(root, { SEED: 'from-process' });
      assert.deepEqual(loaded, { SHARED: 'wallet', ONLY_GENERIC: 'yes' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
