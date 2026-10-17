import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { collectEvidence, totalsOf, type MediaSink, type PlaywrightReport } from './model.ts';

function sink() {
  const saved: string[] = [];
  const located: string[] = [];
  const media: MediaSink = {
    bytes: (attachment) => attachment.body ? Buffer.from(attachment.body, 'base64') : attachment.path ? Buffer.from(`file:${attachment.path}`) : undefined,
    save: (data, kind, ext) => { saved.push(`${kind}${ext}:${data.length}`); return `media/${saved.length}-${kind}${ext}`; },
    locateVideo: (test) => { located.push(test.titlePath.join('/')); return test.titlePath.at(-1) === 'needs lookup' ? '/run/x/attachments/video.mp4' : undefined; },
    copy: (file, kind) => `media/copied-${kind}${file.slice(file.lastIndexOf('.'))}`,
  };
  return { media, saved, located };
}

const tx = (hash: string) => ({ name: 'confirmed-aa-transaction', contentType: 'application/json', body: Buffer.from(JSON.stringify({ hash, userOpHash: `${hash}op` })).toString('base64') });

const report = (status: string, extra: Partial<PlaywrightReport> = {}): PlaywrightReport => ({
  stats: { startTime: '2026-10-17T10:00:00.000Z' },
  suites: [{
    title: 'deploy.spec.ts', file: 'deploy.spec.ts',
    suites: [{
      title: 'token deployment', file: 'deploy.spec.ts',
      specs: [{
        title: 'deploys', file: 'deploy.spec.ts',
        tests: [{ projectName: 'metamask', results: [
          { status: 'failed', duration: 1, retry: 0 },
          { status, duration: 1234, retry: 1, error: status === 'failed' ? { message: 'boom' } : undefined, attachments: [
            tx('0xaaa'),
            { name: 'screenshot', contentType: 'image/png', body: Buffer.from('png').toString('base64') },
            { name: 'video', contentType: 'video/mp4', path: '/run/video.mp4' },
            { name: 'trace', contentType: 'application/zip', path: '/run/trace.zip' },
          ] },
        ] }],
      }],
    }],
  }],
  ...extra,
});

describe('collectEvidence', () => {
  it('builds one row per test from its last result, with media and transactions', () => {
    const { media, saved } = sink();
    const model = collectEvidence([report('passed')], media);
    assert.equal(model.runDate, '2026-10-17');
    assert.equal(model.specs.length, 1);
    const [row] = model.specs[0].tests;
    assert.equal(row.key, 'deploy.spec.ts > token deployment > deploys');
    assert.deepEqual(row.titlePath, ['token deployment', 'deploys']);
    assert.equal(row.status, 'passed');
    assert.equal(row.duration, 1234);
    assert.deepEqual(row.transactions, [{ hash: '0xaaa', userOpHash: '0xaaaop' }]);
    assert.deepEqual(row.screenshots, [{ name: 'screenshot', href: 'media/1-screenshot.png' }]);
    assert.equal(row.video, 'media/2-video.mp4');
    assert.deepEqual(saved, ['screenshot.png:3', 'video.mp4:19']);
    assert.deepEqual(totalsOf(model), { specs: 1, tests: 1, passed: 1, failed: 0, skipped: 0 });
  });

  it('lets a later report replace the same test, keeping the row in place', () => {
    const { media } = sink();
    const model = collectEvidence([report('failed'), report('passed')], media);
    assert.equal(model.specs[0].tests.length, 1);
    assert.equal(model.specs[0].tests[0].status, 'passed');
    assert.equal(model.specs[0].tests[0].error, undefined);
  });

  it('looks a video up by folder when the report has none, with the result\'s retry', () => {
    const { media, located } = sink();
    const model = collectEvidence([{
      suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 'needs lookup', tests: [{ results: [{ status: 'passed', duration: 1, retry: 0 }] }] }] }],
    }], media);
    assert.equal(model.specs[0].tests[0].video, 'media/copied-video.mp4');
    assert.deepEqual(located, ['needs lookup']);
  });

  it('counts timeouts as failures', () => {
    const { media } = sink();
    assert.equal(totalsOf(collectEvidence([report('timedOut')], media)).failed, 1);
  });
});
