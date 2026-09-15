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

export interface NameVideoOptions {
  /** Keep the wallet's home-page recording. Off by default: it is idle for the whole run. */
  walletHomeVideo?: boolean;
}

/**
 * Extension pages that exist to run code, not to be looked at. MetaMask keeps
 * `offscreen.html` open for the whole run to host workers; it renders nothing.
 */
const NON_VISUAL_EXTENSION_PAGE = /\/(?:offscreen|background)\.html(?:[?#]|$)/i;

/**
 * A page that never showed anything: the persistent context's initial
 * `about:blank`, any page whose URL never resolved, and a wallet's invisible
 * worker pages. Its recording is a blank player and its end-of-test screenshot
 * is a blank image, so neither is worth keeping.
 */
export function isNonVisualPageUrl(url: string): boolean {
  if (url === '' || url === 'about:blank') return true;
  return /^(?:chrome|moz)-extension:\/\//i.test(url) && NON_VISUAL_EXTENSION_PAGE.test(url);
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
  options: NameVideoOptions = {},
): { entry: T; attachment: VideoAttachmentName | undefined }[] {
  return nameEntries(entries, 'video', options);
}

export interface NameScreenshotOptions {
  /**
   * Include the wallet's approval windows. They are worth a still only when something went wrong:
   * by the time a passing test ends, an approval it already dealt with is an empty shell.
   */
  approvals?: boolean;
}

/**
 * Names screenshots the same way as recordings — `screenshot`,
 * `screenshot-wallet-approval`, `screenshot-wallet` — and skips the pages that
 * show nothing. A wallet's home page is kept here even though its recording is
 * not: one still image of where the wallet ended up is worth having.
 */
export function nameScreenshotEntries<T extends NamedEntry>(
  entries: readonly T[],
  options: NameScreenshotOptions = {},
): { entry: T; attachment: VideoAttachmentName | undefined }[] {
  const kept = options.approvals
    ? entries
    : entries.filter((entry) => roleOf(entry.url) !== 'wallet-approval' || isNonVisualPageUrl(entry.url));
  const named = nameEntries(kept, 'screenshot', { walletHomeVideo: true });
  const byEntry = new Map(named.map((row) => [row.entry, row.attachment]));

  return entries.map((entry) => ({ entry, attachment: byEntry.get(entry) }));
}

function nameEntries<T extends NamedEntry>(
  entries: readonly T[],
  prefix: 'video' | 'screenshot',
  options: NameVideoOptions = {},
): { entry: T; attachment: VideoAttachmentName | undefined }[] {
  const { walletHomeVideo = false } = options;
  const seen = new Map<VideoRole, number>();
  let kept = 0;

  const roles = entries.map((entry) => (isNonVisualPageUrl(entry.url) ? undefined : roleOf(entry.url)));
  // A wallet's home page is open for the whole run and shows nothing that is
  // not already in the approval windows, so its recording is dropped — unless
  // it is the only recording there is, as in a wallet-only test.
  const dropWalletHome =
    !walletHomeVideo && roles.some((role) => role !== undefined && role !== 'wallet');

  return entries.map((entry, index) => {
    const role = roles[index];
    if (role === undefined) return { entry, attachment: undefined };
    if (role === 'wallet' && dropWalletHome) return { entry, attachment: undefined };
    const count = (seen.get(role) ?? 0) + 1;
    seen.set(role, count);
    kept += 1;

    if (kept === 1) return { entry, attachment: { name: prefix, role } };

    const suffix = count > 1 ? `-${count}` : '';
    return { entry, attachment: { name: `${prefix}-${role}${suffix}`, role } };
  });
}
