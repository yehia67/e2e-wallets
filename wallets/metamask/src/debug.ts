import type { Page } from '@wallets-e2e/core';

const DEBUG = process.env.WALLETS_E2E_DEBUG === '1';

export function debugLog(message: string): void {
  if (DEBUG) console.log(`[wallets/metamask][debug +${Date.now() % 1_000_000}ms] ${message}`);
}

const DEBUG_TESTIDS = [
  'confirm-footer-button',
  'confirmation-submit-button',
  'confirm-btn',
  'page-container-footer-next',
  'signature-sign-button',
  'confirm-nav__next-confirmation',
  'scroll-to-bottom',
  'confirm-alert-modal-submit-button',
  'alert-modal-acknowledge-checkbox',
  'custom-spending-cap-max-button',
] as const;

export async function debugDescribePage(page: Page, label: string): Promise<void> {
  if (!DEBUG) return;
  const found: string[] = [];
  for (const testId of DEBUG_TESTIDS) {
    const locator = page.locator(`[data-testid="${testId}"]`).first();
    if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
      const enabled = await locator.isEnabled().catch(() => false);
      found.push(`${testId}${enabled ? '' : '(disabled)'}`);
    }
  }
  debugLog(`${label}: url=${page.url()} visible=[${found.join(', ') || 'none'}]`);
}
