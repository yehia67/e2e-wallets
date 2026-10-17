// Contributor integration check: build core first, install Playwright Chromium and FFmpeg.
// A real MV3 extension opens wallet windows; FFmpeg decodes the final attachment to verify
// app -> wallet -> app ordering, rather than only asserting that a file exists.
//
// Two video sources are checked. `videoSource: 'chromium'` (Playwright's recorder, composed per
// page) keeps the ordering checks below. The default, `'screenshots'`, is checked for what it was
// introduced for: after a wallet approval opened as a second TAB of the same window, Chromium's
// recorder stops covering the page's viewport and every later frame is cropped; the screenshot
// video must still be the full 1280×720 frame, which `cropdetect` confirms by finding no border.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), 'wallet-recording-check-'));
const playwright = join(dirname(require.resolve('@playwright/test/package.json')), 'index.mjs');
// Exercise the shipped entrypoint from a packed package in an application-owned directory.
const { stdout: packResult } = await exec('npm', ['pack', '--ignore-scripts', '--json',
  '--pack-destination', scratch, '--cache', join(scratch, 'npm-cache')],
  { cwd: resolve(import.meta.dirname, '..') });
const packed = join(scratch, 'node_modules/@wallets-e2e/core');
await mkdir(packed, { recursive: true });
await exec('tar', ['-xzf', join(scratch, JSON.parse(packResult)[0].filename),
  '--strip-components=1', '-C', packed]);
await mkdir(join(scratch, 'node_modules/@playwright'), { recursive: true });
await symlink(dirname(playwright), join(scratch, 'node_modules/@playwright/test'));
const extension = join(scratch, 'extension');
await mkdir(extension);
await writeFile(join(extension, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'Recording test wallet', version: '1.0',
  background: { service_worker: 'worker.js' },
}));
await writeFile(join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
await writeFile(join(extension, 'approval.html'), '<body style="background:rgb(240,20,20)"><h1>Wallet approval</h1><button>Approve</button><script src="approval.js"></script>');
await writeFile(join(extension, 'approval.js'), 'document.querySelector("button").onclick = () => window.close();');
await writeFile(join(extension, 'offscreen.html'), '<body style="background:rgb(20,240,20)">Never record me</body>');
await writeFile(join(scratch, 'playwright.config.mjs'), `export default {
  testDir: '.', testMatch: '*.spec.mjs', timeout: 30000, workers: 1,
  outputDir: ${JSON.stringify(join(scratch, 'results'))},
  reporter: [['json', { outputFile: ${JSON.stringify(join(scratch, 'report.json'))} }]],
  use: { trace: 'off' }
};`);
await writeFile(join(scratch, 'recording.spec.mjs'), `
import { createExtensionTest, resolveExtensionId } from '@wallets-e2e/core';
import { expect } from ${JSON.stringify(pathToFileURL(playwright).href)};
const test = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', videoSource: 'chromium' } });
async function app(page) {
  await page.route('http://app.test/**', route => route.fulfill({ contentType: 'text/html',
    // Light enough (luma > 130) that cropdetect does not take the page for a border, blue enough
    // (blue > 2 × red) that the ordering check below still reads it as the app.
    body: '<body style="background:rgb(120,120,255)"><h1>App</h1><button>Connect</button>' }));
  await page.goto('http://app.test/');
}
async function approval(context, page) {
  const id = await resolveExtensionId(context);
  const popup = await context.newPage();
  await popup.goto('chrome-extension://' + id + '/approval.html');
  await expect(popup.getByRole('button')).toBeVisible();
  await popup.waitForTimeout(200);
  await popup.getByRole('button').click();
  await page.waitForTimeout(200);
}
test('combined', async ({ page, context }) => {
  await app(page);
  await page.waitForTimeout(900);
  const id = await resolveExtensionId(context);
  const worker = context.serviceWorkers()[0];
  const hidden = await context.newPage();
  await hidden.goto('chrome-extension://' + id + '/offscreen.html');
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button').click();
    const opened = context.waitForEvent('page');
    await worker.evaluate(url => chrome.windows.create({ url, type: 'popup', width: 400, height: 600 }),
      'chrome-extension://' + id + '/approval.html');
    const popup = await opened;
    await expect(popup.getByRole('button')).toBeVisible();
    await popup.waitForTimeout(900);
    await popup.getByRole('button').click();
    await page.waitForTimeout(900);
  }
});
test('reused-wallet', async ({ page, context }) => {
  await app(page);
  await page.waitForTimeout(600);
  const id = await resolveExtensionId(context);
  const wallet = await context.newPage();
  await wallet.goto('chrome-extension://' + id + '/approval.html');
  await wallet.waitForTimeout(600);
  await page.bringToFront();
  await page.getByRole('button').click();
  await page.waitForTimeout(600);
  // Reuse an existing surface and interact from an iframe.
  await wallet.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<input aria-label="Amount">';
    document.body.append(frame);
  });
  await wallet.frameLocator('iframe').getByRole('textbox').fill('10');
  await wallet.waitForTimeout(600);
  await page.bringToFront();
  await page.getByRole('button').click();
  await page.waitForTimeout(600);
});
const separate = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', videoLayout: 'separate', videoSource: 'chromium' } });
separate('separate', async ({ page, context }) => { await app(page); await approval(context, page); });
const off = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', video: 'off' } });
off('off', async ({ page }) => { await app(page); });
const retained = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', video: 'retain-on-failure', videoSource: 'chromium' } });
retained('retained-pass', async ({ page }) => { await app(page); });
retained('retained-failure', async ({ page }) => { await app(page); await page.waitForTimeout(200); expect(1).toBe(2); });
const fallback = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', ffmpegPath: '/missing/ffmpeg', videoSource: 'chromium' } });
fallback('fallback', async ({ page, context }) => { await app(page); await approval(context, page); });
// The default source: screenshots of the page in use, encoded to mp4.
const shots = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', screenshotVideo: { intervalMs: 100 } } });
shots('screenshots-popup', async ({ page, context }) => {
  await app(page);
  await page.waitForTimeout(600);
  const id = await resolveExtensionId(context);
  const worker = context.serviceWorkers()[0];
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button').click();
    const opened = context.waitForEvent('page');
    await worker.evaluate(url => chrome.windows.create({ url, type: 'popup', width: 400, height: 600 }),
      'chrome-extension://' + id + '/approval.html');
    const popup = await opened;
    await expect(popup.getByRole('button')).toBeVisible();
    await popup.waitForTimeout(600);
    await popup.getByRole('button').click();
    await page.waitForTimeout(600);
  }
});
// The case the default exists for: an approval opened as a second tab of the same window.
shots('screenshots-tab', async ({ page, context }) => {
  await app(page);
  await page.waitForTimeout(600);
  await approval(context, page);
  await page.getByRole('button').click();
  await page.waitForTimeout(1500);
});
const shotsRetained = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', video: 'retain-on-failure' } });
shotsRetained('screenshots-retained-pass', async ({ page }) => { await app(page); await page.waitForTimeout(400); });
`);
try {
  const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  try { await exec(process.execPath, [cli, 'test', '--config', join(scratch, 'playwright.config.mjs')],
    { timeout: 180_000, maxBuffer: 1024 * 1024 }); }
  catch (error) { if (error.code !== 1) throw error; } // One intentional test failure checks retention.
  const report = JSON.parse(await readFile(join(scratch, 'report.json'), 'utf8'));
  assert.deepEqual(report.errors, []);
  const cases = report.suites.flatMap(suite => suite.specs).map(spec => ({
    name: spec.title, result: spec.tests[0].results[0],
  }));
  assert.equal(cases.length, 10);
  for (const { name, result } of cases) {
    assert.equal(result.status, name === 'retained-failure' ? 'failed' : 'passed', JSON.stringify(result.errors));
    if (name.startsWith('screenshots-')) {
      const mp4s = result.attachments.filter(item => item.contentType === 'video/mp4');
      const outputs = await readdir(join(scratch, 'results'));
      const directory = outputs.find(directory => directory.endsWith(name));
      assert.ok(directory, name);
      const leftovers = await readdir(join(scratch, 'results', directory));
      assert.ok(!leftovers.includes('video-frames'), 'Frames leaked: ' + name);
      if (name === 'screenshots-retained-pass') {
        assert.equal(mp4s.length, 0, name);
        continue;
      }
      assert.equal(mp4s.length, 1, name);
      assert.equal(mp4s[0].name, 'video');
      assert.equal(result.attachments.filter(item => item.contentType === 'video/webm').length, 0, name);
      const { stdout: probe } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0', mp4s[0].path]);
      assert.equal(probe.trim().replace(/,$/, ''), '1280,720', name);
      // The last second of the tab case is after the approval tab: the frame must be all page, no border.
      // `skip=0`: cropdetect ignores its first two frames by default, and only a few are read.
      const { stderr: crop } = await exec('ffmpeg', ['-hide_banner', '-sseof', '-1', '-i', mp4s[0].path,
        '-frames:v', '3', '-vf', 'cropdetect=limit=130:round=2:reset=1:skip=0', '-f', 'null', '-']);
      const detected = [...crop.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
      assert.ok(detected, 'cropdetect reported nothing: ' + name);
      assert.deepEqual(detected.slice(1, 5), ['1280', '720', '0', '0'], 'Cropped frame in ' + name + ': ' + detected[0]);
      console.log('Verified full-frame screenshot video:', name);
      continue;
    }
    const videos = result.attachments.filter(item => item.contentType === 'video/webm');
    const expected = ['off', 'retained-pass'].includes(name) ? 0 :
      ['separate', 'fallback'].includes(name) ? 2 : 1;
    assert.equal(videos.length, expected, name);
    if (['separate', 'fallback'].includes(name)) {
      assert.deepEqual(videos.map(video => video.name), ['video', 'video-wallet-approval']);
    }
    if (!['separate', 'fallback'].includes(name)) {
      const outputs = await readdir(join(scratch, 'results'));
      const directory = outputs.find(directory => directory.endsWith(name));
      assert.ok(directory, name);
      const raw = await readdir(join(scratch, 'results', directory, 'videos')).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      assert.equal(raw.filter(file => file.endsWith('.webm')).length, 0, 'Intermediate recordings leaked');
    }
    if (!['combined', 'reused-wallet'].includes(name)) continue;
    assert.equal(videos[0].name, 'video');
    const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', videos[0].path,
      '-vf', 'fps=10,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'],
      { encoding: 'buffer', maxBuffer: 1024 * 1024 });
    const colors = [];
    for (let index = 0; index < stdout.length; index += 3) {
      const [red, green, blue] = stdout.subarray(index, index + 3);
      assert.ok(!(green > red * 2 && green > blue * 2), 'Invisible extension page leaked into video');
      const color = red > blue * 2 ? 'wallet' : blue > red * 2 ? 'app' : undefined;
      if (color && colors.at(-1) !== color) colors.push(color);
    }
    const repeats = name === 'combined' ? 5 : 2;
    assert.deepEqual(colors, ['app', ...Array.from({ length: repeats }, () => ['wallet', 'app']).flat()]);
    console.log('Verified encoded video:', colors.join(' -> '));
  }
  console.log('Verified combined/separate/off/retention/encoder-failure fixture behavior, and the screenshot source.');
} catch (error) {
  console.error('Integration artifacts:', scratch);
  throw error;
}
if (process.env.KEEP_RECORDING_CHECK !== '1') await rm(scratch, { recursive: true, force: true });
else console.log('Integration artifacts:', scratch);
