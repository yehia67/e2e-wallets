import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { isNonVisualPageUrl, nameScreenshotEntries, nameVideoEntries } from './video-names.ts';

describe('nameVideoEntries', () => {
  it('names each recording after what it shows', () => {
    const named = nameVideoEntries([
      { url: 'http://localhost:5173/token/0x1/operations' },
      { url: 'chrome-extension://wallet-id/notification.html#confirm-transaction/1' },
    ]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['video', 'video-wallet-approval'],
    );
  });

  it("drops the wallet's idle home recording when there is anything else to show", () => {
    const named = nameVideoEntries([
      { url: 'http://localhost:5173/' },
      { url: 'chrome-extension://wallet-id/home.html' },
      { url: 'chrome-extension://wallet-id/notification.html#connect/1' },
    ]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['video', undefined, 'video-wallet-approval'],
    );
  });

  it('keeps the wallet home recording when it is the only one, so a wallet-only test still has a video', () => {
    const named = nameVideoEntries([
      { url: 'about:blank' },
      { url: 'chrome-extension://wallet-id/home.html' },
    ]);

    assert.equal(named[1].attachment?.name, 'video');
  });

  it('keeps the wallet home recording when the caller asks for it', () => {
    const named = nameVideoEntries(
      [{ url: 'http://localhost:5173/' }, { url: 'chrome-extension://wallet-id/home.html' }],
      { walletHomeVideo: true },
    );

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['video', 'video-wallet'],
    );
  });

  it('numbers repeats of the same role so several approvals stay distinguishable', () => {
    const named = nameVideoEntries([
      { url: 'https://dapp.test/' },
      { url: 'chrome-extension://wallet-id/notification.html#connect/1' },
      { url: 'chrome-extension://wallet-id/notification.html#confirm-transaction/2' },
      { url: 'chrome-extension://wallet-id/notification.html#confirm-transaction/3' },
    ]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['video', 'video-wallet-approval', 'video-wallet-approval-2', 'video-wallet-approval-3'],
    );
  });

  it('drops recordings of pages that never showed anything', () => {
    const named = nameVideoEntries([
      { url: 'about:blank' },
      { url: '' },
      { url: 'http://localhost:5173/' },
    ]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      [undefined, undefined, 'video'],
    );
  });

  it('names the first kept recording `video` even when a blank page came first', () => {
    const named = nameVideoEntries([
      { url: 'about:blank' },
      { url: 'https://dapp.test/' },
    ]);

    assert.equal(named[1].attachment?.name, 'video');
    assert.equal(named[1].attachment?.role, 'dapp');
  });

  it('falls back to a neutral role for anything that is neither dapp nor wallet', () => {
    const named = nameVideoEntries([{ url: 'file:///tmp/review.html' }, { url: 'data:text/html,x' }]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['video', 'video-page-2'],
    );
  });

  it('recognises the pages that never showed anything', () => {
    assert.equal(isNonVisualPageUrl('about:blank'), true);
    assert.equal(isNonVisualPageUrl(''), true);
    assert.equal(isNonVisualPageUrl('chrome-extension://wallet-id/offscreen.html'), true);
    assert.equal(isNonVisualPageUrl('chrome-extension://wallet-id/background.html'), true);
    assert.equal(isNonVisualPageUrl('http://localhost:5173/'), false);
    assert.equal(isNonVisualPageUrl('chrome-extension://wallet-id/home.html'), false);
    assert.equal(isNonVisualPageUrl('chrome-extension://wallet-id/notification.html#connect/1'), false);
  });

  it("drops a wallet's invisible worker page instead of naming it", () => {
    const named = nameVideoEntries([
      { url: 'http://localhost:5173/' },
      { url: 'chrome-extension://wallet-id/offscreen.html' },
      { url: 'chrome-extension://wallet-id/notification.html#connect/1' },
    ]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['video', undefined, 'video-wallet-approval'],
    );
  });

  it('names screenshots of the pages worth looking at, approvals aside', () => {
    const named = nameScreenshotEntries([
      { url: 'http://localhost:5173/' },
      { url: 'chrome-extension://wallet-id/home.html' },
      { url: 'chrome-extension://wallet-id/notification.html#confirm-transaction/1' },
      { url: 'chrome-extension://wallet-id/offscreen.html' },
    ]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['screenshot', 'screenshot-wallet', undefined, undefined],
    );
  });

  it('includes the approval window when a test failed, where what was on screen matters', () => {
    const named = nameScreenshotEntries(
      [
        { url: 'http://localhost:5173/' },
        { url: 'chrome-extension://wallet-id/notification.html#confirm-transaction/1' },
      ],
      { approvals: true },
    );

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['screenshot', 'screenshot-wallet-approval'],
    );
  });
});
