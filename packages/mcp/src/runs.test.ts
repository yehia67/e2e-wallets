import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  assertSafeTestFile,
  classifyArtifact,
  detectPlaywrightLauncher,
} from './launcher.ts';

describe('detectPlaywrightLauncher', () => {
  it('follows pnpm, yarn, then npm lockfiles walking up from the project', () => {
    const root = mkdtempSync(join(tmpdir(), 'wallets-e2e-mcp-launcher-'));
    try {
      mkdirSync(join(root, 'apps', 'dapp'), { recursive: true });
      writeFileSync(join(root, 'pnpm-lock.yaml'), '');
      const pnpm = detectPlaywrightLauncher(join(root, 'apps', 'dapp'));
      assert.equal(pnpm.manager, 'pnpm');
      assert.deepEqual(pnpm.testArgs, ['exec', 'playwright', 'test']);

      rmSync(join(root, 'pnpm-lock.yaml'));
      writeFileSync(join(root, 'yarn.lock'), '');
      assert.equal(detectPlaywrightLauncher(join(root, 'apps', 'dapp')).manager, 'yarn');

      rmSync(join(root, 'yarn.lock'));
      writeFileSync(join(root, 'package-lock.json'), '{}');
      const npm = detectPlaywrightLauncher(join(root, 'apps', 'dapp'));
      assert.equal(npm.manager, 'npm');
      assert.deepEqual(npm.testArgs, ['playwright', 'test']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('assertSafeTestFile', () => {
  it('allows a relative spec and refuses traversal', () => {
    const root = mkdtempSync(join(tmpdir(), 'wallets-e2e-mcp-testfile-'));
    try {
      assert.equal(assertSafeTestFile('tests/deposit.spec.ts', root), 'tests/deposit.spec.ts');
      assert.throws(() => assertSafeTestFile('../secret.spec.ts', root), /without "\.\."/);
      assert.throws(() => assertSafeTestFile('/tmp/evil.spec.ts', root), /without "\.\."/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('classifyArtifact', () => {
  it('labels video, screenshot, and trace attachments', () => {
    assert.equal(classifyArtifact('video', 'video/webm', '/tmp/a.webm'), 'video');
    assert.equal(classifyArtifact('screenshot', 'image/png', '/tmp/a.png'), 'screenshot');
    assert.equal(classifyArtifact('trace', 'application/zip', '/tmp/trace.zip'), 'trace');
    assert.equal(classifyArtifact('log', 'text/plain', '/tmp/a.txt'), 'other');
  });
});
