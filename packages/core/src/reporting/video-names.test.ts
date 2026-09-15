import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { nameVideoEntries } from './video-names.ts';

describe('nameVideoEntries', () => {
  it('names each recording after what it shows', () => {
    const named = nameVideoEntries([
      { url: 'http://localhost:5173/token/0x1/operations' },
      { url: 'chrome-extension://wallet-id/notification.html#confirm-transaction/1' },
      { url: 'chrome-extension://wallet-id/home.html' },
    ]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['video', 'video-wallet-approval', 'video-wallet'],
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
      { url: 'chrome-extension://wallet-id/home.html' },
    ]);

    assert.equal(named[1].attachment?.name, 'video');
    assert.equal(named[1].attachment?.role, 'wallet');
  });

  it('falls back to a neutral role for anything that is neither dapp nor wallet', () => {
    const named = nameVideoEntries([{ url: 'file:///tmp/review.html' }, { url: 'data:text/html,x' }]);

    assert.deepEqual(
      named.map(({ attachment }) => attachment?.name),
      ['video', 'video-page-2'],
    );
  });
});
