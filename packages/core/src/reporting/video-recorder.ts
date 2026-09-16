import type { BrowserContext, Frame, Page, Video } from '@playwright/test';
import { isNonVisualPageUrl } from './video-names.js';
import { VideoTimeline, type VideoSegment } from './video-timeline.js';

export interface TrackedVideo {
  video: Video;
  url: string;
  startedAt: number;
}

/** Observe trusted interactions in every frame, including extension pages and reused popups. */
function observeActivity(binding: string): void {
  const notify = (): void => {
    const call = (window as unknown as Record<string, () => Promise<void>>)[binding];
    void call().catch(() => undefined); // The context may be closing.
  };
  for (const event of ['pointerdown', 'keydown', 'input', 'focus']) {
    window.addEventListener(event, (event) => {
      if (event.isTrusted) notify();
    }, true);
  }
}

/** Collect videos before context.close(), which both clears pages() and flushes video files. */
export async function trackVideos(context: BrowserContext, combined: boolean): Promise<{
  videos: TrackedVideo[];
  stop: () => VideoSegment<TrackedVideo>[];
}> {
  const entries = new Map<Page, TrackedVideo>();
  const videos: TrackedVideo[] = [];
  const timeline = new VideoTimeline<TrackedVideo>();
  const cleanups: (() => void)[] = [];
  let stopped = false;
  let combinedReady = combined;
  const activate = (page: Page): void => {
    const entry = entries.get(page);
    if (stopped || !entry || page.isClosed() || isNonVisualPageUrl(page.url())) return;
    timeline.activate(entry, performance.now());
  };
  const track = (page: Page): void => {
    if (entries.has(page)) return;
    const video = page.video();
    if (!video) return;
    const entry = { video, url: page.url(), startedAt: performance.now() };
    entries.set(page, entry);
    videos.push(entry);
    activate(page);
    const navigate = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      const wasBlank = isNonVisualPageUrl(entry.url);
      entry.url = frame.url();
      if (isNonVisualPageUrl(entry.url)) timeline.close(entry, performance.now());
      else if (wasBlank) activate(page);
    };
    const close = (): void => timeline.close(entry, performance.now());
    page.on('framenavigated', navigate);
    page.on('close', close);
    page.on('crash', close);
    cleanups.push(() => {
      page.off('framenavigated', navigate);
      page.off('close', close);
      page.off('crash', close);
    });
  };
  context.on('page', track);
  context.pages().forEach(track);
  try {
    if (combined) {
      const binding = '__walletsE2EVideoActivity';
      await context.exposeBinding(binding, ({ page }) => activate(page));
      await context.addInitScript(observeActivity, binding);
      // addInitScript covers future documents; existing pages need installing once now.
      await Promise.all(context.pages().map((page) =>
        page.evaluate(observeActivity, binding).catch(() => undefined),
      ));
    }
  } catch (cause) {
    combinedReady = false;
    console.warn('[@wallets-e2e/core] Video activity tracking unavailable; retaining separate page videos.', cause);
  }
  return {
    videos,
    stop: () => {
      stopped = true;
      context.off('page', track);
      cleanups.forEach((cleanup) => cleanup());
      return combinedReady ? timeline.finish(performance.now()) : [];
    },
  };
}
