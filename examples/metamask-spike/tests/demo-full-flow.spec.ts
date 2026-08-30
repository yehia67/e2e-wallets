import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVM_NETWORKS,
  createInjectedEvmRpc,
  waitForEthTransactionMined,
} from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';
import {
  loadDeployedContracts,
  readVaultBalance,
  waitForVaultBalanceIncrease,
} from './contracts.js';

const NETWORK = EVM_NETWORKS.sepolia;

test.describe('live Sepolia uninterrupted acceptance flow', () => {
  test(`import → ${NETWORK.name} → connect → ETH → approve deposit → permit deposit`, async ({ extensionContext }) => {
    test.setTimeout(15 * 60 * 1000);

    const deployed = loadDeployedContracts();
    const depositAmount = BigInt(deployed.depositAmount);

    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    const appPage = await extensionContext.newPage();
    await appPage.goto('/');
    await appPage.waitForLoadState('domcontentloaded');
    await metamaskDriver.switchNetwork?.(extensionContext, NETWORK);
    await expect(appPage.getByTestId('connect-wallet')).toBeVisible({ timeout: 15_000 });

    await metamaskDriver.connectToDapp(extensionContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
    });
    await expect(appPage.getByTestId('connected-address')).toContainText(wallet.address, {
      timeout: 15_000,
      ignoreCase: true,
    });
    const requester = createInjectedEvmRpc(appPage);

    await metamaskDriver.confirmTransaction(extensionContext, async () => {
      await appPage.getByTestId('send-eth').click();
    });
    await expect(appPage.getByTestId('tx-hash')).toBeVisible({ timeout: 30_000 });
    const ethStatus = (await appPage.getByTestId('tx-hash').innerText()).trim();
    if (ethStatus.startsWith('error:')) {
      throw new Error(`ETH send failed in dapp: ${ethStatus}`);
    }
    const ethTxHash = ethStatus;
    expect(ethTxHash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(
      await waitForEthTransactionMined(ethTxHash, {
        requester,
        timeoutMs: 8 * 60 * 1000,
      }),
    ).toBe('success');

    const vaultBalanceBefore = await readVaultBalance(
      deployed.vaultAddress,
      wallet.address,
      requester,
    );

    await metamaskDriver.approveTokenPermission(extensionContext, async () => {
      await appPage.getByTestId('approve-token').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toContainText(/^approve-tx:0x/i, { timeout: 30_000 });
    const approvalTxHash = (await appPage.getByTestId('deposit-status').innerText())
      .replace(/^approve-tx:/i, '')
      .trim();
    expect(
      await waitForEthTransactionMined(approvalTxHash, {
        requester,
        timeoutMs: 8 * 60 * 1000,
      }),
    ).toBe('success');

    await metamaskDriver.confirmTransaction(extensionContext, async () => {
      await appPage.getByTestId('deposit-after-approve').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toContainText(/^deposit-tx:0x/i, { timeout: 30_000 });

    const depositStatus = await appPage.getByTestId('deposit-status').innerText();
    const depositTxHash = depositStatus.replace(/^deposit-tx:/i, '').trim();
    expect(
      await waitForEthTransactionMined(depositTxHash, {
        requester,
        timeoutMs: 8 * 60 * 1000,
      }),
    ).toBe('success');

    await metamaskDriver.confirmSignature(extensionContext, async () => {
      await appPage.getByTestId('deposit-permit-sign').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toHaveText('permit-signed', {
      timeout: 30_000,
    });

    await metamaskDriver.confirmTransaction(extensionContext, async () => {
      await appPage.getByTestId('deposit-permit-submit').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toContainText(
      /^permit-deposit-tx:0x/i,
      { timeout: 30_000 },
    );
    const permitDepositTxHash = (await appPage.getByTestId('deposit-status').innerText())
      .replace(/^permit-deposit-tx:/i, '')
      .trim();
    expect(
      await waitForEthTransactionMined(permitDepositTxHash, {
        requester,
        timeoutMs: 8 * 60 * 1000,
      }),
    ).toBe('success');

    const vaultBalanceAfter = await waitForVaultBalanceIncrease(
      deployed.vaultAddress,
      wallet.address,
      vaultBalanceBefore,
      depositAmount * 2n,
      requester,
    );
    expect(vaultBalanceAfter - vaultBalanceBefore).toBe(depositAmount * 2n);

    const dappVideo = await appPage.video()?.path();
    if (dappVideo) {
      writeFileSync(join(import.meta.dirname, '../test-results/demo-video-path.txt'), dappVideo);
    }
  });
});
