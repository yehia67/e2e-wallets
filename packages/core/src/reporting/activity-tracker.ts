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

const ACTIVITY_BINDING = '__walletsE2EVideoActivity';

/** Per context, the trackers its one exposed binding reports to. */
const activityListeners = new WeakMap<BrowserContext, Set<(page: Page) => void>>();

/** Observe trusted interactions in every frame, including extension pages and reused popups. */
function observeActivity(binding: string): void {
  const notify = (): void => {
    // A wallet's own pages run under LavaMoat, which throws on reading an unknown global. An
    // uncaught exception there can break the wallet's approval screen, so nothing here may throw.
    try {
      const call = (window as unknown as Record<string, (() => Promise<void>) | undefined>)[binding];
      if (typeof call === 'function') void call().catch(() => undefined); // The context may be closing.
    } catch {
      // Not observable in this page; the recorder falls back to the last page it saw.
    }
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
      // A browser that outlives one test (`contextScope: 'worker'`) is tracked once per test, but a
      // binding can be exposed only once per context: it is installed on first use and routes to
      // the trackers listening at the moment.
      let listeners = activityListeners.get(context);
      if (listeners === undefined) {
        listeners = new Set();
        activityListeners.set(context, listeners);
        const routed = listeners;
        await context.exposeBinding(ACTIVITY_BINDING, ({ page }) => routed.forEach((listener) => listener(page)));
        await context.addInitScript(observeActivity, ACTIVITY_BINDING);
        // addInitScript covers future documents; existing pages need installing once now.
        await Promise.all(context.pages().map((page) =>
          page.evaluate(observeActivity, ACTIVITY_BINDING).catch(() => undefined),
        ));
      }
      listeners.add(activate);
      const registered = listeners;
      cleanups.push(() => registered.delete(activate));
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
