interface NamedEntry {
  url: string;
}

/** What a recording turned out to be, or `undefined` when it is not worth keeping. */
export interface VideoAttachmentName {
  /** Attachment name, e.g. `video`, `video-wallet-approval-2`. */
  name: string;
  /** The role the name was built from, for messages and tests. */
  role: VideoRole;
}

export type VideoRole = 'dapp' | 'wallet-approval' | 'wallet' | 'page';

/**
 * A recording of a page that never showed anything: the persistent context's
 * initial `about:blank`, and any page whose URL never resolved. Attaching these
 * puts blank players in the report next to the real ones.
 */
function isBlank(url: string): boolean {
  return url === '' || url === 'about:blank';
}

function roleOf(url: string): VideoRole {
  if (/^https?:\/\//i.test(url)) return 'dapp';
  if (/^(?:chrome|moz)-extension:\/\//i.test(url)) {
    // Wallets raise approvals in their own notification window; the rest of the
    // extension's pages are its home UI, open for the whole run.
    return /notification|approval|popup/i.test(url) ? 'wallet-approval' : 'wallet';
  }
  return 'page';
}

/**
 * Names each recording after what it shows, so a report lists `video`,
 * `video-wallet-approval` and `video-wallet` instead of `video`, `video-2`,
 * `video-3`, and drops the recordings of pages that never showed anything.
 *
 * Entries are expected in attachment order (see `orderVideoEntriesForAttachment`):
 * the first kept entry is named exactly `video`, which is the name Playwright's
 * HTML reporter renders as the test's primary player.
 */
export function nameVideoEntries<T extends NamedEntry>(
  entries: readonly T[],
): { entry: T; attachment: VideoAttachmentName | undefined }[] {
  const seen = new Map<VideoRole, number>();
  let kept = 0;

  return entries.map((entry) => {
    if (isBlank(entry.url)) return { entry, attachment: undefined };

    const role = roleOf(entry.url);
    const count = (seen.get(role) ?? 0) + 1;
    seen.set(role, count);
    kept += 1;

    if (kept === 1) return { entry, attachment: { name: 'video', role } };

    const suffix = count > 1 ? `-${count}` : '';
    return { entry, attachment: { name: `video-${role}${suffix}`, role } };
  });
}
