interface VideoEntry {
  url: string;
}

/**
 * Puts useful browser recordings ahead of Chromium's persistent-context `about:blank` page.
 * The first entry becomes Playwright's primary `video` attachment, so prefer the dapp, then the
 * wallet extension, while preserving page-creation order within each group.
 */
export function orderVideoEntriesForAttachment<T extends VideoEntry>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        videoPriority(left.entry.url) - videoPriority(right.entry.url) || left.index - right.index,
    )
    .map(({ entry }) => entry);
}

function videoPriority(url: string): number {
  if (/^https?:\/\//i.test(url)) return 0;
  if (/^(?:chrome|moz)-extension:\/\//i.test(url)) return 1;
  if (url && url !== 'about:blank') return 2;
  return 3;
}
