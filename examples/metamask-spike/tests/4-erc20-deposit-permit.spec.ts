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

test.describe('ERC20 deposit via permit', () => {
  test('signs EIP-2612 permit and deposits with depositWithPermit', async ({ extensionContext }) => {
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

    await metamaskDriver.confirmSignature!(extensionContext, async () => {
      await appPage.getByTestId('deposit-permit-sign').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toHaveText('permit-signed', { timeout: 30_000 });

    await metamaskDriver.confirmTransaction(extensionContext, async () => {
      await appPage.getByTestId('deposit-permit-submit').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toContainText(/^permit-deposit-tx:0x/i, { timeout: 30_000 });

    const depositStatus = await appPage.getByTestId('deposit-status').innerText();
    const txHash = depositStatus.replace(/^permit-deposit-tx:/i, '').trim();
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
