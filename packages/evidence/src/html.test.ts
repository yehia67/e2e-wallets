import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { renderSite } from './html.ts';
import type { EvidenceModel } from './model.ts';

const model: EvidenceModel = {
  runDate: '2026-10-17',
  specs: [{
    file: 'roles.spec.ts',
    tests: [{
      key: 'k', file: 'roles.spec.ts', titlePath: ['roles', 'grants <AGENT>'], title: 'grants <AGENT>', status: 'passed', duration: 63_700,
      transactions: [{ hash: `0x${'a'.repeat(64)}`, userOpHash: `0x${'b'.repeat(64)}` }],
      screenshots: [{ name: 'screenshot', href: 'media/1-screenshot.png' }], video: 'media/2-video.mp4',
    }, {
      key: 'f', file: 'roles.spec.ts', titlePath: ['revokes'], title: 'revokes', status: 'failed', duration: 10, error: 'expected <x>', transactions: [], screenshots: [],
    }],
  }],
};
const totals = { specs: 1, tests: 2, passed: 1, failed: 1, skipped: 0 };

describe('renderSite', () => {
  it('renders the title, totals, the run date and every row, escaping markup', () => {
    const html = renderSite(model, { title: 'Console E2E <Evidence>', totals, explorerTxUrl: 'https://sepolia.basescan.org/tx/' });
    assert.match(html, /<title>Console E2E &lt;Evidence&gt;<\/title>/);
    assert.match(html, /run of 2026-10-17/);
    assert.match(html, /<b>1<\/b>passed/);
    assert.match(html, /grants &lt;AGENT&gt;/);
    assert.match(html, /· roles<\/small>/);
    assert.match(html, /href="https:\/\/sepolia\.basescan\.org\/tx\/0xa{64}"/);
    assert.match(html, /<video controls preload="metadata" src="media\/2-video\.mp4">/);
    assert.match(html, /<pre class="err">expected &lt;x&gt;<\/pre>/);
    assert.match(html, /pill bad">1\/2 passed/);
    assert.match(html, /name="robots" content="noindex"/);
  });

  it('shows hashes as text when there is no explorer, and the full flow when given', () => {
    const html = renderSite(model, { title: 'T', totals, fullFlow: { title: 'Whole flow', href: 'media/flow.mp4', clips: 9, description: 'All nine steps.' } });
    assert.doesNotMatch(html, /href="https:/);
    assert.match(html, /<code>0xaaaaaaaa…aaaaaa<\/code>/);
    assert.match(html, /Whole flow <span class="pill ok">9 clips in run order/);
    assert.match(html, /src="media\/flow\.mp4"/);
  });
});
