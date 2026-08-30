/**
 * Single-session live acceptance: import → network → connect → ETH transfer → approve deposit →
 * EIP-2612 permit deposit. Runs only when WALLETS_E2E_RUN_SEPOLIA=1, or while recording the demo.
 * Do not generate a GIF from connect-only or partial runs.
 */
import {
  EVM_NETWORKS,
  createInjectedEvmRpc,
  waitForEthTransactionMined,
} from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';
import { loadDeployedContracts, readVaultBalance } from './contracts.js';

/** The network under test — an argument to the driver, not baked into it. */
const NETWORK = EVM_NETWORKS.sepolia;

const isDemoRecording = process.env.WALLETS_E2E_RECORD_DEMO === '1';
const isLiveSepolia = process.env.WALLETS_E2E_RUN_SEPOLIA === '1';

test.describe('live Sepolia uninterrupted acceptance flow', () => {
  test.skip(
    !isDemoRecording && !isLiveSepolia,
    'Set WALLETS_E2E_RUN_SEPOLIA=1 to authorize the gas-spending Sepolia flow.',
  );

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

    const vaultBalanceAfter = await readVaultBalance(
      deployed.vaultAddress,
      wallet.address,
      requester,
    );
    expect(vaultBalanceAfter - vaultBalanceBefore).toBe(depositAmount * 2n);
  });
});
