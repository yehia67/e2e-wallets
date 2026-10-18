import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Page } from '@playwright/test';
import { pagesToCloseAfterTest } from './worker-context.ts';

const page = (url: string, closed = false): Page => ({ url: () => url, isClosed: () => closed }) as unknown as Page;
const nonVisual = (url: string): boolean => url === 'about:blank' || /offscreen|background/.test(url);

describe('pagesToCloseAfterTest', () => {
  it('closes what the test opened, app tab and stray approval alike', () => {
    const home = page('chrome-extension://abc/home.html');
    const blank = page('about:blank');
    const app = page('http://127.0.0.1:4310/token/0x1/operations');
    const popup = page('chrome-extension://abc/notification.html');
    const closing = pagesToCloseAfterTest(new Set([home, blank]), [home, blank, app, popup], nonVisual);
    assert.deepEqual(closing, [app, popup]);
  });

  it('keeps the wallet pages and the initial blank tab from before the test', () => {
    const home = page('chrome-extension://abc/home.html');
    const offscreen = page('chrome-extension://abc/offscreen.html');
    const blank = page('about:blank');
    assert.deepEqual(pagesToCloseAfterTest(new Set([home, offscreen, blank]), [home, offscreen, blank], nonVisual), []);
  });

  it('closes an app tab left over from an earlier test, and skips pages already closed', () => {
    const earlier = page('http://127.0.0.1:4310/tokens');
    const gone = page('http://127.0.0.1:4310/connect', true);
    assert.deepEqual(pagesToCloseAfterTest(new Set([earlier, gone]), [earlier, gone], nonVisual), [earlier]);
  });
});
