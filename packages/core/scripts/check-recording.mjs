// Contributor integration check: build core first, install Playwright Chromium and FFmpeg.
// A real MV3 extension opens wallet windows; FFmpeg decodes the final attachment to verify
// app -> wallet -> app ordering, rather than only asserting that a file exists.
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
  artifacts: { screenshot: 'off' } });
async function app(page) {
  await page.route('http://app.test/**', route => route.fulfill({ contentType: 'text/html',
    body: '<body style="background:rgb(20,20,240)"><h1>App</h1><button>Connect</button>' }));
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
  artifacts: { screenshot: 'off', videoLayout: 'separate' } });
separate('separate', async ({ page, context }) => { await app(page); await approval(context, page); });
const off = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', video: 'off' } });
off('off', async ({ page }) => { await app(page); });
const retained = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', video: 'retain-on-failure' } });
retained('retained-pass', async ({ page }) => { await app(page); });
retained('retained-failure', async ({ page }) => { await app(page); await page.waitForTimeout(200); expect(1).toBe(2); });
const fallback = createExtensionTest({ extensionPath: ${JSON.stringify(extension)}, headless: true,
  artifacts: { screenshot: 'off', ffmpegPath: '/missing/ffmpeg' } });
fallback('fallback', async ({ page, context }) => { await app(page); await approval(context, page); });
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
  assert.equal(cases.length, 7);
  for (const { name, result } of cases) {
    assert.equal(result.status, name === 'retained-failure' ? 'failed' : 'passed', JSON.stringify(result.errors));
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
  console.log('Verified combined/separate/off/retention/encoder-failure fixture behavior.');
} catch (error) {
  console.error('Integration artifacts:', scratch);
  throw error;
}
if (process.env.KEEP_RECORDING_CHECK !== '1') await rm(scratch, { recursive: true, force: true });
else console.log('Integration artifacts:', scratch);
