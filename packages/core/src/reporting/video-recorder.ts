import type { BrowserContext, Page, Video } from '@playwright/test';
import { trackActivity } from './activity-tracker.js';
import { isNonVisualPageUrl } from './video-names.js';
import { VideoTimeline, type VideoSegment } from './video-timeline.js';

export interface TrackedVideo {
  video: Video;
  url: string;
  startedAt: number;
}

/**
 * Collect Chromium's per-page videos before context.close(), which both clears pages() and
 * flushes video files, and — in combined mode — the timeline of which page was in use when.
 */
export async function trackVideos(context: BrowserContext, combined: boolean): Promise<{
  videos: TrackedVideo[];
  stop: () => VideoSegment<TrackedVideo>[];
}> {
  const entries = new Map<Page, TrackedVideo>();
  const videos: TrackedVideo[] = [];
  const timeline = new VideoTimeline<TrackedVideo>();
  let stopped = false;

  const activate = (page: Page, at: number): void => {
    const entry = entries.get(page);
    if (stopped || !entry || page.isClosed() || isNonVisualPageUrl(page.url())) return;
    timeline.activate(entry, at);
  };
  const tracker = await trackActivity(context, {
    onPage: (page, at) => {
      const video = page.video();
      if (!video) return;
      const entry = { video, url: page.url(), startedAt: at };
      entries.set(page, entry);
      videos.push(entry);
      activate(page, at);
    },
    onActivate: activate,
    onNavigate: (page, url, at) => {
      const entry = entries.get(page);
      if (!entry) return;
      const wasBlank = isNonVisualPageUrl(entry.url);
      entry.url = url;
      if (isNonVisualPageUrl(url)) timeline.close(entry, at);
      else if (wasBlank) activate(page, at);
    },
    onClose: (page, at) => {
      const entry = entries.get(page);
      if (entry) timeline.close(entry, at);
    },
  }, { observe: combined });
  if (combined && !tracker.available) {
    console.warn('[@wallets-e2e/core] Video activity tracking unavailable; retaining separate page videos.');
  }

  return {
    videos,
    stop: () => {
      stopped = true;
      tracker.stop();
      return combined && tracker.available ? timeline.finish(performance.now()) : [];
    },
  };
}
