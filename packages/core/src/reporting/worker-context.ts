import type { Page } from '@playwright/test';

/**
 * The pages a test must give back when the browser context outlives it (`contextScope: 'worker'`).
 *
 * Everything the test opened goes: its app tab, and any wallet approval it left behind, which
 * would otherwise answer the next test's prompt. Pages that were open before the test stay —
 * the wallet's home and worker pages, and the context's initial blank tab — because the wallet's
 * state lives in them and the next test starts from that state on purpose. An app page that was
 * open before the test is the one exception: it is this test's or an earlier test's tab, never
 * the wallet's, and keeping it would leave one more tab per test.
 *
 * @param isNonVisual Whether a URL is a page that shows nothing (`isNonVisualPageUrl`); taken as
 *   an argument so this stays testable from source, where sibling modules cannot be imported.
 */
export function pagesToCloseAfterTest(
  openedBefore: ReadonlySet<Page>,
  pages: readonly Page[],
  isNonVisual: (url: string) => boolean,
): Page[] {
  return pages.filter((page) => {
    if (page.isClosed()) return false;
    if (!openedBefore.has(page)) return true;
    const url = page.url();
    return /^https?:\/\//.test(url) && !isNonVisual(url);
  });
}
