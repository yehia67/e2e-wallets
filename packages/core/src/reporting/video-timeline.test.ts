import assert from 'node:assert/strict';
import { it } from 'node:test';
import { VideoTimeline } from './video-timeline.ts';

it('returns to the app when each wallet popup closes, using one shared clock', () => {
  const timeline = new VideoTimeline<string>();
  timeline.activate('app', 100);
  timeline.activate('wallet', 400);
  timeline.activate('wallet', 500); // Repeated input does not split the clip.
  timeline.close('wallet', 900);
  timeline.activate('second-wallet', 1100);
  timeline.close('second-wallet', 1500);
  assert.deepEqual(timeline.finish(2000), [
    { source: 'app', start: 100, end: 400 },
    { source: 'wallet', start: 400, end: 900 },
    { source: 'app', start: 900, end: 1100 },
    { source: 'second-wallet', start: 1100, end: 1500 },
    { source: 'app', start: 1500, end: 2000 },
  ]);
});

it('follows interactions on a reused wallet tab and ignores background tab closure', () => {
  const timeline = new VideoTimeline<string>();
  timeline.activate('home', 0);
  timeline.activate('app', 100);
  timeline.close('home', 200);
  timeline.activate('wallet', 300);
  timeline.activate('app', 400);
  timeline.activate('wallet', 500);
  timeline.close('wallet', 600);
  assert.deepEqual(timeline.finish(700).map((segment) => segment.source),
    ['home', 'app', 'wallet', 'app', 'wallet', 'app']);
});

it('does not invent footage after all visual pages close or on duplicate stop', () => {
  const timeline = new VideoTimeline<string>();
  timeline.activate('app', 10);
  timeline.close('app', 10);
  timeline.activate('wallet', 50);
  timeline.close('wallet', 100);
  assert.deepEqual(timeline.finish(200), [{ source: 'wallet', start: 50, end: 100 }]);
  assert.deepEqual(timeline.finish(300), [{ source: 'wallet', start: 50, end: 100 }]);
});
