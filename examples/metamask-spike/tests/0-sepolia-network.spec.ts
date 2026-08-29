/**
 * Focused MetaMask → Sepolia network switch. This is the blocker for connect/send.
 * Run alone: WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm exec playwright test tests/0-sepolia-network.spec.ts
 */
import { resolveExtensionId } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';

test('switches MetaMask home network to Sepolia', async ({ extensionContext }) => {
  test.setTimeout(3 * 60 * 1000);

  await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
  await metamaskDriver.switchToTestnetNetwork?.(extensionContext);

  const extensionId = await resolveExtensionId(extensionContext);
  const home =
    extensionContext.pages().find(
      (p) => !p.isClosed() && p.url().includes(`chrome-extension://${extensionId}/`) && p.url().includes('home.html'),
    ) ?? (await extensionContext.newPage());

  if (!home.url().includes('home.html')) {
    await home.goto(`chrome-extension://${extensionId}/home.html`);
  }

  const networkLabel = home.locator('[data-testid="sort-by-networks"]');
  await expect(networkLabel).toContainText(/sepolia/i, { timeout: 30_000 });
});
