import type { BrowserContext, Frame, Page } from '@playwright/test';
import { isNonVisualPageUrl } from './video-names.js';

/** What the tracker reports, in page order on one monotonic clock (`performance.now()`). */
export interface ActivityEvents {
  /** A page joined the context (existing pages are reported on start). */
  onPage?: (page: Page, at: number) => void;
  /** The user interacted with the page: a trusted pointer, key, input or focus event. */
  onActivate?: (page: Page, at: number) => void;
  /** The page's main frame navigated to `url`. */
  onNavigate?: (page: Page, url: string, at: number) => void;
  /** The page closed or crashed. */
  onClose?: (page: Page, at: number) => void;
}

export interface ActivityTracker {
  /** The page the user last interacted with that is still open and shows something. */
  current(): Page | undefined;
  /** False when the in-page observer could not be installed; `current()` then stays undefined. */
  available: boolean;
  stop(): void;
}

/** Observe trusted interactions in every frame, including extension pages and reused popups. */
function observeActivity(binding: string): void {
  const notify = (): void => {
    const call = (window as unknown as Record<string, () => Promise<void>>)[binding];
    void call().catch(() => undefined); // The context may be closing.
  };
  for (const event of ['pointerdown', 'keydown', 'input', 'focus']) {
    window.addEventListener(event, (event) => {
      if (event.isTrusted) notify();
    }, true);
  }
}

/**
 * Follows which page the user is working in.
 *
 * Both recorders need the same answer — the Chromium one to cut its timeline, the screenshot one
 * to know which page to photograph — so the page bookkeeping and the in-page observer live here
 * once. `observe: false` keeps the page lifecycle events without installing the observer.
 */
export async function trackActivity(
  context: BrowserContext,
  events: ActivityEvents,
  options: { observe?: boolean } = {},
): Promise<ActivityTracker> {
  const { observe = true } = options;
  const seen = new Set<Page>();
  const cleanups: (() => void)[] = [];
  let stopped = false;
  let available = observe;
  let current: Page | undefined;

  const activate = (page: Page): void => {
    if (stopped || page.isClosed() || isNonVisualPageUrl(page.url())) return;
    current = page;
    events.onActivate?.(page, performance.now());
  };
  const track = (page: Page): void => {
    if (seen.has(page)) return;
    seen.add(page);
    events.onPage?.(page, performance.now());
    const navigate = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      events.onNavigate?.(page, frame.url(), performance.now());
    };
    const close = (): void => {
      if (current === page) current = undefined;
      events.onClose?.(page, performance.now());
    };
    page.on('framenavigated', navigate);
    page.on('close', close);
    page.on('crash', close);
    cleanups.push(() => {
      page.off('framenavigated', navigate);
      page.off('close', close);
      page.off('crash', close);
    });
  };
  context.on('page', track);
  context.pages().forEach(track);
  try {
    if (observe) {
      const binding = '__walletsE2EVideoActivity';
      await context.exposeBinding(binding, ({ page }) => activate(page));
      await context.addInitScript(observeActivity, binding);
      // addInitScript covers future documents; existing pages need installing once now.
      await Promise.all(context.pages().map((page) =>
        page.evaluate(observeActivity, binding).catch(() => undefined),
      ));
    }
  } catch (cause) {
    available = false;
    console.warn('[@wallets-e2e/core] Page activity tracking unavailable.', cause);
  }
  return {
    get available() {
      return available;
    },
    current: () => (current && !current.isClosed() ? current : undefined),
    stop: () => {
      stopped = true;
      context.off('page', track);
      cleanups.forEach((cleanup) => cleanup());
    },
  };
}
