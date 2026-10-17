import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { findEnvFiles, liveWritesEnabled, loadEnvFiles, optionalEnv, parseEnvFile, requiredEnv } from './env.ts';

function tempDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'wallets-e2e-env-'));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

describe('parseEnvFile', () => {
  it('reads plain, quoted, exported and value-with-= lines and skips comments', () => {
    assert.deepEqual(parseEnvFile([
      '# comment', 'PLAIN=one', 'QUOTED="two"', "SINGLE='three'", 'export EXPORTED=four',
      'URL=https://x/y?a=b', '', 'NOEQ',
    ].join('\n')), { PLAIN: 'one', QUOTED: 'two', SINGLE: 'three', EXPORTED: 'four', URL: 'https://x/y?a=b' });
  });

  it('leaves out a key with an empty value, quoted or not', () => {
    assert.deepEqual(parseEnvFile('EMPTY=\nQUOTED=""\nKEPT=x'), { KEPT: 'x' });
  });

  it('keeps the first occurrence of a key', () => {
    assert.deepEqual(parseEnvFile('A=1\nA=2'), { A: '1' });
  });
});

describe('findEnvFiles', () => {
  it('returns the nearest directory that has any of the files, in name order', () => {
    const root = tempDir({ '.env.local': 'A=root', 'app/.env.wallet-e2e.local': 'A=app', 'app/.env.local': 'B=app' });
    assert.deepEqual(findEnvFiles(join(root, 'app', 'tests')), [
      join(root, 'app', '.env.wallet-e2e.local'),
      join(root, 'app', '.env.local'),
    ]);
  });

  it('finds nothing when no file is within reach', () => {
    assert.deepEqual(findEnvFiles(tempDir({}), ['.env.nope'], 0), []);
  });
});

describe('loadEnvFiles', () => {
  it('fills what the environment lacks and never overwrites what it has, even when empty', () => {
    const root = tempDir({ '.env.wallet-e2e.local': 'SEED=from-file\nFLAG=1\nEMPTY=\nKEEP_EMPTY=file' });
    const env: NodeJS.ProcessEnv = { FLAG: '0', KEEP_EMPTY: '' };
    const applied = loadEnvFiles({ cwd: root, env });
    assert.deepEqual(applied, [join(root, '.env.wallet-e2e.local')]);
    assert.deepEqual(env, { FLAG: '0', KEEP_EMPTY: '', SEED: 'from-file' });
  });

  it('lets the nearer file win over the farther one', () => {
    const root = tempDir({ '.env.wallet-e2e.local': 'A=near', '.env.local': 'A=far\nB=far' });
    const env: NodeJS.ProcessEnv = {};
    loadEnvFiles({ cwd: root, env });
    assert.deepEqual(env, { A: 'near', B: 'far' });
  });
});

describe('env helpers', () => {
  it('requiredEnv names the missing variable and carries the hint', () => {
    delete process.env.WALLETS_E2E_TEST_MISSING;
    assert.throws(() => requiredEnv('WALLETS_E2E_TEST_MISSING', 'Export it.'), /WALLETS_E2E_TEST_MISSING is not set\. Export it\./);
    process.env.WALLETS_E2E_TEST_MISSING = ' value ';
    assert.equal(requiredEnv('WALLETS_E2E_TEST_MISSING'), 'value');
  });

  it('optionalEnv treats empty and whitespace as unset', () => {
    process.env.WALLETS_E2E_TEST_OPTIONAL = '  ';
    assert.equal(optionalEnv('WALLETS_E2E_TEST_OPTIONAL'), undefined);
    process.env.WALLETS_E2E_TEST_OPTIONAL = 'x';
    assert.equal(optionalEnv('WALLETS_E2E_TEST_OPTIONAL'), 'x');
  });

  it('liveWritesEnabled accepts exactly "1" on the named flag', () => {
    process.env.WALLETS_E2E_TEST_LIVE = 'true';
    assert.equal(liveWritesEnabled('WALLETS_E2E_TEST_LIVE'), false);
    process.env.WALLETS_E2E_TEST_LIVE = '1';
    assert.equal(liveWritesEnabled('WALLETS_E2E_TEST_LIVE'), true);
  });
});
