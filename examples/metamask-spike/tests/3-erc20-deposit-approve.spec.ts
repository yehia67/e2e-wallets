import {
  EVM_NETWORKS,
  createInjectedEvmRpc,
  waitForEthTransactionMined,
} from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';
import {
  readVaultBalance,
  requireDeployedContracts,
  waitForVaultBalanceIncrease,
} from './contracts.js';

const NETWORK = EVM_NETWORKS.sepolia;

test.describe('ERC20 deposit via approve', () => {
  test('approves token allowance and deposits into the vault', async ({ extensionContext }) => {
    test.setTimeout(10 * 60 * 1000);
    const deployed = requireDeployedContracts();
    const depositAmount = BigInt(deployed.depositAmount);

    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    const appPage = await extensionContext.newPage();
    await appPage.goto('/');
    await metamaskDriver.switchNetwork?.(extensionContext, NETWORK);

    await metamaskDriver.connectToDapp(extensionContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
    });

    const requester = createInjectedEvmRpc(appPage);
    const balanceBefore = await readVaultBalance(deployed.vaultAddress, wallet.address, requester);

    await metamaskDriver.approveTokenPermission(extensionContext, async () => {
      await appPage.getByTestId('approve-token').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toContainText(/^approve-tx:0x/i, { timeout: 30_000 });
    const approvalHash = (await appPage.getByTestId('deposit-status').innerText())
      .replace(/^approve-tx:/i, '')
      .trim();
    expect(
      await waitForEthTransactionMined(approvalHash, {
        requester,
        timeoutMs: 8 * 60 * 1000,
      }),
    ).toBe('success');

    await metamaskDriver.confirmTransaction(extensionContext, async () => {
      await appPage.getByTestId('deposit-after-approve').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toContainText(/^deposit-tx:0x/i, { timeout: 30_000 });

    const depositStatus = await appPage.getByTestId('deposit-status').innerText();
    const txHash = depositStatus.replace(/^deposit-tx:/i, '').trim();
    const status = await waitForEthTransactionMined(txHash, {
      requester,
      timeoutMs: 8 * 60 * 1000,
    });
    expect(status).toBe('success');

    const balanceAfter = await waitForVaultBalanceIncrease(
      deployed.vaultAddress,
      wallet.address,
      balanceBefore,
      depositAmount,
      requester,
    );
    expect(balanceAfter - balanceBefore).toBe(depositAmount);
  });
});
