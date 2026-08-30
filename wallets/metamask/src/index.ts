import type { BrowserContext, EvmNetwork, WalletAccount, WalletDriver } from '@wallets-e2e/core';
import { EVM_NETWORKS, resolveExtensionId } from '@wallets-e2e/core';
import { APPROVAL_SELECTORS } from './selectors.js';
import { assertMetaMaskPopupUrl } from './utils.js';
import { hasAuthorizedDappAccount } from './session.js';
import { importWallet } from './onboarding.js';
import {
  clickConnectApprove,
  clickSignatureConfirm,
  clickTransactionConfirm,
  resolveApprovalPage,
  resolveMetaMaskApprovalPage,
  waitForApprovalToSettle,
} from './approvals.js';
import { applyPendingNetworkToDapp, ensureNetwork } from './networks.js';

export interface ApproveTokenPermissionOptions {
  spendLimit?: 'requested' | 'max' | number;
}

export interface MetaMaskDriver extends WalletDriver<EvmNetwork> {
  approveTokenPermission(
    context: BrowserContext,
    trigger: () => Promise<void>,
    options?: ApproveTokenPermissionOptions,
  ): Promise<void>;
  confirmSignature(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
}

export const metamaskDriver: MetaMaskDriver = {
  async importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount> {
    return importWallet(context, seedPhrase);
  },

  async switchNetwork(context: BrowserContext, network: EvmNetwork): Promise<void> {
    await ensureNetwork(context, network);
  },

  async switchToTestnetNetwork(context: BrowserContext): Promise<void> {
    await ensureNetwork(context, EVM_NETWORKS.sepolia);
  },

  async connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

    await applyPendingNetworkToDapp(context, extensionId);

    await trigger();

    const authorizationDeadline = Date.now() + 3_000;
    while (Date.now() < authorizationDeadline) {
      if (await hasAuthorizedDappAccount(context, extensionId)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const popup = await resolveMetaMaskApprovalPage(context, extensionId);

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'connectToDapp');
    await popup.waitForLoadState('domcontentloaded');

    await clickConnectApprove(popup);
    await waitForApprovalToSettle(popup);
  },

  async confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

    await trigger();

    const popup = await resolveApprovalPage(
      context,
      extensionId,
      APPROVAL_SELECTORS.any,
      'confirmTransaction',
    );

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'confirmTransaction');
    await popup.waitForLoadState('domcontentloaded');
    await popup
      .locator(APPROVAL_SELECTORS.confirmationReady)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    for (let i = 0; i < 3; i++) {
      const nextNav = popup.locator('[data-testid="confirm-nav__next-confirmation"]');
      if (await nextNav.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await nextNav.click();
        await popup.waitForTimeout(300);
        continue;
      }
      break;
    }

    await clickTransactionConfirm(popup);
    const confirmBtn = popup.locator('[data-testid="confirm-btn"]');
    if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await waitForApprovalToSettle(popup);
  },

  async approveTokenPermission(
    context: BrowserContext,
    trigger: () => Promise<void>,
    options: ApproveTokenPermissionOptions = {},
  ): Promise<void> {
    const extensionId = await resolveExtensionId(context);
    await trigger();
    const popup = await resolveApprovalPage(
      context,
      extensionId,
      `${APPROVAL_SELECTORS.permission}, ${APPROVAL_SELECTORS.any}`,
      'approveTokenPermission',
    );
    assertMetaMaskPopupUrl(popup.url(), extensionId, 'approveTokenPermission');
    await popup.waitForLoadState('domcontentloaded');

    if (options.spendLimit === 'max') {
      await popup.locator('[data-testid="custom-spending-cap-max-button"]').click();
    } else if (typeof options.spendLimit === 'number') {
      if (!Number.isFinite(options.spendLimit) || options.spendLimit < 0) {
        throw new Error('[wallets/metamask] approveTokenPermission: spendLimit must be non-negative.');
      }
      await popup
        .locator('[data-testid="custom-spending-cap-input"]')
        .fill(String(options.spendLimit));
    }

    const next = popup.locator('[data-testid="page-container-footer-next"]');
    if (await next.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await next.click();
      await popup.waitForTimeout(300);
    }
    await clickTransactionConfirm(popup);
    await waitForApprovalToSettle(popup);
  },

  async confirmSignature(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

    await trigger();

    const popup = await resolveApprovalPage(
      context,
      extensionId,
      `${APPROVAL_SELECTORS.signature}, ${APPROVAL_SELECTORS.any}`,
      'confirmSignature',
    );

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'confirmSignature');
    await popup.waitForLoadState('domcontentloaded');
    await popup
      .locator(APPROVAL_SELECTORS.signatureReady)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    await clickSignatureConfirm(popup);
    await waitForApprovalToSettle(popup);
  },
};
