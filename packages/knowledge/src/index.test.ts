import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { GUIDES, guidePath, readGuide } from './index.ts';

describe('GUIDES', () => {
  it('has unique ids and every listed file exists', () => {
    const ids = GUIDES.map((guide) => guide.id);
    assert.equal(ids.length, new Set(ids).size);
    for (const guide of GUIDES) {
      assert.equal(existsSync(guidePath(guide.id)), true, `missing ${guide.file}`);
    }
  });

  it('starts agents at feature-to-test', () => {
    assert.equal(GUIDES.some((guide) => guide.id === 'feature-to-test'), true);
    assert.match(readGuide('feature-to-test'), /start_run/);
  });

  it('rejects unknown ids with the known list', () => {
    assert.throws(() => readGuide('not-a-guide'), /Unknown guide "not-a-guide"/);
  });
});
