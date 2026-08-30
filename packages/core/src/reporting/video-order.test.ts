import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { orderVideoEntriesForAttachment } from './video-order.ts';

describe('orderVideoEntriesForAttachment', () => {
  it('selects the dapp recording as the primary video instead of an initial blank page', () => {
    const blank = { id: 'blank', url: 'about:blank' };
    const wallet = { id: 'wallet', url: 'chrome-extension://wallet-id/home.html' };
    const dapp = { id: 'dapp', url: 'http://localhost:5173/' };

    const ordered = orderVideoEntriesForAttachment([blank, wallet, dapp]);

    assert.equal(ordered[0], dapp);
    assert.deepEqual(ordered.map(({ id }) => id), ['dapp', 'wallet', 'blank']);
  });

  it('keeps creation order within each priority and puts all non-blank pages before blank ones', () => {
    const entries = [
      { id: 'blank', url: '' },
      { id: 'wallet-1', url: 'moz-extension://wallet-id/notification.html' },
      { id: 'other-1', url: 'file:///tmp/review.html' },
      { id: 'dapp-1', url: 'https://example.test/one' },
      { id: 'dapp-2', url: 'http://localhost:5173/two' },
      { id: 'wallet-2', url: 'chrome-extension://wallet-id/home.html' },
      { id: 'other-2', url: 'data:text/html,review' },
      { id: 'about-blank', url: 'about:blank' },
    ];

    assert.deepEqual(
      orderVideoEntriesForAttachment(entries).map(({ id }) => id),
      ['dapp-1', 'dapp-2', 'wallet-1', 'wallet-2', 'other-1', 'other-2', 'blank', 'about-blank'],
    );
  });
});
