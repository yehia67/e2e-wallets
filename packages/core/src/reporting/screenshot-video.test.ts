import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { buildConcatList, ffmpegEncodeArgs } from './frame-list.ts';
import { DEFAULT_SCREENSHOT_VIDEO, resolveScreenshotVideoOptions, resolveVideoSource } from './artifacts.ts';

describe('buildConcatList', () => {
  it('shows each frame for as long as it was current and holds the last one for the tail', () => {
    const list = buildConcatList([
      { file: '000001.jpg', at: 1_000 },
      { file: '000002.jpg', at: 1_250 },
      { file: '000003.jpg', at: 1_900 },
    ], 1_500);
    assert.equal(list, [
      "file '000001.jpg'", 'duration 0.250',
      "file '000002.jpg'", 'duration 0.650',
      "file '000003.jpg'", 'duration 1.500',
      "file '000003.jpg'",
    ].join('\n') + '\n');
  });

  it('keeps a single frame on screen for the tail alone', () => {
    assert.equal(buildConcatList([{ file: '000001.jpg', at: 5 }], 2_000),
      "file '000001.jpg'\nduration 2.000\nfile '000001.jpg'\n");
  });

  it('never emits a zero duration, which the concat demuxer would drop', () => {
    const list = buildConcatList([{ file: 'a.jpg', at: 10 }, { file: 'b.jpg', at: 10 }], 500);
    assert.match(list, /file 'a.jpg'\nduration 0\.001/);
  });

  it('is empty for no frames', () => {
    assert.equal(buildConcatList([], 500), '\n');
  });
});

describe('ffmpegEncodeArgs', () => {
  it('encodes the list into an H.264 mp4 at the requested rate and quality, output last', () => {
    const args = ffmpegEncodeArgs('frames.txt', '/out/video.mp4', { ...DEFAULT_SCREENSHOT_VIDEO, fps: 30, crf: 18 });
    assert.equal(args.at(-1), '/out/video.mp4');
    assert.ok(args.includes('frames.txt'));
    assert.ok(args.includes('libx264'));
    assert.ok(args.includes('yuv420p'));
    assert.equal(args[args.indexOf('-crf') + 1], '18');
    assert.equal(args[args.indexOf('-vf') + 1], 'pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30');
  });
});

describe('resolveScreenshotVideoOptions', () => {
  it('fills every setting from the defaults', () => {
    assert.deepEqual(resolveScreenshotVideoOptions(), DEFAULT_SCREENSHOT_VIDEO);
  });

  it('keeps what the caller set and ignores undefined', () => {
    assert.deepEqual(resolveScreenshotVideoOptions({ intervalMs: 500, quality: undefined }),
      { ...DEFAULT_SCREENSHOT_VIDEO, intervalMs: 500 });
  });
});

describe('resolveVideoSource', () => {
  it('records from screenshots by default', () => {
    assert.deepEqual(resolveVideoSource(undefined, true), { source: 'screenshots', fallback: false });
  });

  it('falls back to Chromium when screenshots cannot be encoded', () => {
    assert.deepEqual(resolveVideoSource(undefined, false), { source: 'chromium', fallback: true });
    assert.deepEqual(resolveVideoSource('screenshots', false), { source: 'chromium', fallback: true });
  });

  it('honours an explicit Chromium choice whether or not FFmpeg is there', () => {
    assert.deepEqual(resolveVideoSource('chromium', false), { source: 'chromium', fallback: false });
    assert.deepEqual(resolveVideoSource('chromium', true), { source: 'chromium', fallback: false });
  });
});
