import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { parseCliArgs } from './cli-args.ts';
import { headersFile, netlifyToml } from './site-files.ts';

describe('parseCliArgs', () => {
  it('reads lists, flags and values', () => {
    const args = parseCliArgs(['--report', 'a.json,b.json', '--out', 'site', '--test-results', 'r1, r2', '--netlify', '--explorer-tx-url', 'https://x/tx/', '--full-flow', 'use-case-one.spec.ts']);
    assert.deepEqual(args.reports, ['a.json', 'b.json']);
    assert.equal(args.out, 'site');
    assert.deepEqual(args.testResults, ['r1', 'r2']);
    assert.equal(args.netlify, true);
    assert.equal(args.explorerTxUrl, 'https://x/tx/');
    assert.equal(args.fullFlow, 'use-case-one.spec.ts');
    assert.equal(args.title, 'Wallet E2E Evidence');
  });

  it('refuses a missing report or out, an unknown flag, and a flag without its value', () => {
    assert.throws(() => parseCliArgs(['--out', 'x']), /--report is required/);
    assert.throws(() => parseCliArgs(['--report', 'a']), /--out is required/);
    assert.throws(() => parseCliArgs(['--report', 'a', '--out', 'x', '--bogus']), /Unknown option --bogus/);
    assert.throws(() => parseCliArgs(['--report', '--out']), /--report needs a value/);
    assert.equal(parseCliArgs(['--help']).help, true);
  });
});

describe('site files', () => {
  it('cover every media type and ask not to be indexed', () => {
    const headers = headersFile();
    for (const ext of ['mp4', 'webm', 'png', 'jpg']) assert.match(headers, new RegExp(`/media/\\*\\.${ext}`));
    assert.match(headers, /X-Robots-Tag: noindex/);
    assert.match(netlifyToml(), /publish = "\."/);
    assert.match(netlifyToml(), /NETLIFY_NEXT_PLUGIN_SKIP/);
  });
});
