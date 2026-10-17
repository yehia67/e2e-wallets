import type { ConsoleMessage, Page } from '@playwright/test';

export interface PageLogCollector {
  lines(): string[];
  stop(): void;
}

/**
 * Collects what a page said in its console, so a failed test can say why the click never reached
 * the wallet. Errors and warnings by default; every message, echoed to stdout as it happens, when
 * `WALLETS_E2E_DEBUG=1`.
 */
export function collectPageLogs(
  page: Page,
  options: { echo?: boolean; all?: boolean; max?: number } = {},
): PageLogCollector {
  const debug = process.env.WALLETS_E2E_DEBUG === '1';
  const { echo = debug, all = debug, max = 500 } = options;
  const lines: string[] = [];
  const label = (): string => {
    try {
      return new URL(page.url()).host || page.url();
    } catch {
      return page.url();
    }
  };
  const push = (line: string): void => {
    if (lines.length < max) lines.push(line);
    if (echo) console.log(`[wallets-e2e][page ${label()}] ${line}`);
  };
  const onConsole = (message: ConsoleMessage): void => {
    const type = message.type();
    if (!all && type !== 'error' && type !== 'warning') return;
    push(`${type}: ${message.text().slice(0, 500)}`);
  };
  const onError = (error: Error): void => push(`pageerror: ${error.message.slice(0, 500)}`);
  page.on('console', onConsole);
  page.on('pageerror', onError);
  return {
    lines: () => [...lines],
    stop: () => {
      page.off('console', onConsole);
      page.off('pageerror', onError);
    },
  };
}
