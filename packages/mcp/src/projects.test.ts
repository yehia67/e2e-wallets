import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { discoverProjects, resolveProject } from './projects.ts';

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'wallets-e2e-mcp-projects-'));
  mkdirSync(join(root, 'dapp'));
  writeFileSync(join(root, 'dapp', 'playwright.config.ts'), 'export default {};\n');
  return root;
}

describe('discoverProjects', () => {
  it('ids projects by path relative to the root', () => {
    const root = tempRoot();
    try {
      const found = discoverProjects(root);
      assert.deepEqual(
        found.map((project) => project.id),
        ['dapp'],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('resolveProject', () => {
  it('accepts a discovered id and refuses paths', () => {
    const root = tempRoot();
    try {
      assert.equal(resolveProject('dapp', root).id, 'dapp');
      assert.throws(() => resolveProject('/etc/passwd', root), /not a project id/);
      assert.throws(() => resolveProject('../dapp', root), /not a project id/);
      assert.throws(() => resolveProject('missing', root), /Unknown project "missing"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
