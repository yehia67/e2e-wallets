import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MANIFEST = join(ROOT, 'examples/metamask-spike/test-results/demo-pages.json');
const OUT = join(ROOT, 'docs/metamask-demo-full-flow.gif');

const SPEED = Number(process.env.DEMO_SPEED ?? 4);
const FPS = Number(process.env.DEMO_FPS ?? 12);
const PANE_WIDTH = Number(process.env.DEMO_PANE_WIDTH ?? 480);

function duration(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    file,
  ]);
  return Number(String(out).trim());
}

if (!existsSync(MANIFEST)) {
  console.error(`Missing ${MANIFEST} — run the demo spec first.`);
  process.exit(1);
}

const pages = JSON.parse(readFileSync(MANIFEST, 'utf8')).filter((p) => existsSync(p.video));

const dapp = pages.find((p) => /^https?:\/\//.test(p.url));
if (!dapp) {
  console.error('No dapp page recording found in the manifest.');
  process.exit(1);
}

const popups = pages.filter((p) => p.url.includes('notification.html'));
if (popups.length === 0) {
  console.error('No MetaMask notification recordings found — nothing to show on the right pane.');
  process.exit(1);
}

const dappDuration = duration(dapp.video);
const popupTimes = popups.map((p) => {
  const dur = duration(p.video);
  return { ...p, dur, start: Math.max(0, dappDuration - dur) };
});
popupTimes.sort((a, b) => a.start - b.start);

console.log(`dapp    ${dappDuration.toFixed(1)}s  ${dapp.url}`);
for (const p of popupTimes) {
  console.log(`popup   ${p.dur.toFixed(1)}s  starts at ${p.start.toFixed(1)}s`);
}

// Every page recording ends when the browser context closes, so a page's start on the shared
// timeline is (total - its own duration). Each popup is painted onto a blank pane only during its
// own window, which keeps the right-hand side showing whichever approval was actually on screen.
const inputs = ['-i', dapp.video, ...popupTimes.flatMap((p) => ['-i', p.video])];

const filters = [];
filters.push(`color=c=white:s=${PANE_WIDTH}x${Math.round((PANE_WIDTH * 450) / 800)}:d=${dappDuration}[pane0]`);
filters.push(`[0:v]scale=${PANE_WIDTH}:-2,setsar=1[left]`);

popupTimes.forEach((p, index) => {
  const input = index + 1;
  filters.push(
    `[${input}:v]scale=${PANE_WIDTH}:-2,setsar=1,tpad=start_duration=${p.start.toFixed(3)}:start_mode=add:color=white[p${index}]`,
  );
  filters.push(
    `[pane${index}][p${index}]overlay=0:0:enable='between(t,${p.start.toFixed(3)},${(p.start + p.dur).toFixed(3)})'[pane${index + 1}]`,
  );
});

const rightPane = `pane${popupTimes.length}`;
filters.push(`[left][${rightPane}]hstack=inputs=2[stacked]`);
filters.push(
  `[stacked]setpts=PTS/${SPEED},fps=${FPS},split[s0][s1];[s0]palettegen=stats_mode=diff:max_colors=256[pal];[s1][pal]paletteuse=dither=bayer:bayer_scale=3[out]`,
);

execFileSync(
  'ffmpeg',
  ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-loop', '0', OUT],
  { stdio: 'inherit' },
);

console.log(`\nwrote ${OUT}`);
