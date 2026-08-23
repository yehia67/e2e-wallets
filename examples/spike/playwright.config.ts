import { defineConfig } from '@playwright/test';

/**
 * NFR2: Playwright's bundled Chromium only (`channel: 'chromium'`) — never branded Chrome/Edge.
 * FR7: video-record every run. Tests in this package launch their own persistent context via
 * `packages/core#launchContext` (AD-1) rather than the built-in `context`/`page` fixtures, so
 * `use.video` here documents the project's recording intent and covers any future test that does
 * use the built-in fixtures; the spike test itself passes a `recordVideoDir` explicitly to
 * `launchContext` to guarantee a video file is produced regardless.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    channel: 'chromium',
    video: 'on',
  },
});
