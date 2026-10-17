import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { BrowserContext, Page } from '@playwright/test';
import { trackActivity } from './activity-tracker.js';
import type { ScreenshotVideoOptions } from './artifacts.js';
import { buildConcatList, ffmpegEncodeArgs, type FrameEntry } from './frame-list.js';
import { isNonVisualPageUrl, roleOf } from './video-names.js';

export { buildConcatList, ffmpegEncodeArgs, type FrameEntry } from './frame-list.js';

const execFileAsync = promisify(execFile);


export interface ScreenshotRecorder {
  /** Stops capturing and returns the frames taken, in order. */
  stop(): Promise<FrameEntry[]>;
}

/**
 * Records the test by photographing the page in use, instead of through Chromium's video capture.
 *
 * Chromium's `recordVideo` films the compositor surface. Once a wallet driver has opened an
 * approval as a second tab of the same window, that surface stops covering the page's viewport:
 * every later frame holds the top-left ~80% of the page with flat background beside it, while the
 * page's own metrics (viewport, window bounds, `innerWidth`) still report the full size, and
 * neither resizing the window nor re-applying the viewport brings it back. `page.screenshot()`
 * goes through CDP's `captureScreenshot` and is always the whole viewport, so this takes one
 * every `intervalMs` and `encodeScreenshotVideo` turns them into a video with real timing.
 *
 * Which page is photographed follows the user: the page last interacted with, when `scope`
 * admits it, otherwise the newest page that does. `'app'` admits only http(s) pages; `'all'`
 * also admits a wallet's approval windows.
 */
export async function startScreenshotRecorder(
  context: BrowserContext,
  args: {
    framesDir: string;
    options: Required<ScreenshotVideoOptions>;
    scope: 'app' | 'all';
    debug?: (message: string) => void;
  },
): Promise<ScreenshotRecorder> {
  const { framesDir, options, scope, debug } = args;
  await mkdir(framesDir, { recursive: true });
  const tracker = await trackActivity(context, {});
  const frames: FrameEntry[] = [];
  let stopped = false;

  const admitted = (page: Page): boolean => {
    if (page.isClosed() || isNonVisualPageUrl(page.url())) return false;
    const role = roleOf(page.url());
    return role === 'dapp' || (scope === 'all' && role === 'wallet-approval');
  };
  const subject = (): Page | undefined => {
    const active = tracker.current();
    if (active && admitted(active)) return active;
    return context.pages().filter(admitted).at(-1);
  };

  const capture = (async () => {
    while (!stopped) {
      const page = subject();
      if (page) {
        const file = `${String(frames.length + 1).padStart(6, '0')}.jpg`;
        try {
          // `caret: 'initial'` skips the stylesheet Playwright injects to hide the caret, which
          // would otherwise be added and removed on every frame; the page is left as it is.
          const body = await page.screenshot({
            type: 'jpeg', quality: options.quality, timeout: 2_000, caret: 'initial', animations: 'allow',
          });
          await writeFile(join(framesDir, file), body);
          frames.push({ file, at: performance.now() });
        } catch (cause) {
          // A navigation or a closing page can lose one frame; the next tick carries on.
          debug?.(`frame skipped: ${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)}`);
        }
      }
      await delay(options.intervalMs);
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      tracker.stop();
      await capture;
      return frames;
    },
  };
}

export async function encodeScreenshotVideo(
  frames: readonly FrameEntry[],
  framesDir: string,
  output: string,
  options: Required<ScreenshotVideoOptions>,
  ffmpegPath = 'ffmpeg',
): Promise<void> {
  if (frames.length === 0) throw new Error('No frames were captured.');
  const list = 'frames.txt';
  await writeFile(join(framesDir, list), buildConcatList(frames, options.tailMs));
  await execFileAsync(ffmpegPath, ffmpegEncodeArgs(list, output, options), { cwd: framesDir, timeout: 120_000 });
}

const ffmpegProbes = new Map<string, Promise<boolean>>();

/** Whether `ffmpegPath` runs, asked once per process and remembered. */
export function ffmpegAvailable(ffmpegPath = 'ffmpeg'): Promise<boolean> {
  let probe = ffmpegProbes.get(ffmpegPath);
  if (!probe) {
    probe = execFileAsync(ffmpegPath, ['-version'], { timeout: 10_000 }).then(() => true, () => false);
    ffmpegProbes.set(ffmpegPath, probe);
  }
  return probe;
}
