import { SEPOLIA_RPC_URL, waitForEthTransactionMined } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';
import { readVaultBalance, requireDeployedContracts } from './contracts.js';

test.describe('ERC20 deposit via permit', () => {
  test('signs EIP-2612 permit and deposits with depositWithPermit', async ({ extensionContext }, testInfo) => {
    test.setTimeout(10 * 60 * 1000);
    const deployed = requireDeployedContracts(testInfo);
    const depositAmount = BigInt(deployed.depositAmount);

    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    await metamaskDriver.switchToTestnetNetwork?.(extensionContext);

    const appPage = await extensionContext.newPage();
    await appPage.goto('/');

    await metamaskDriver.connectToDapp(extensionContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
    });

    const balanceBefore = await readVaultBalance(deployed.vaultAddress, wallet.address);

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
      rpcUrl: SEPOLIA_RPC_URL,
      timeoutMs: 8 * 60 * 1000,
    });
    expect(status).toBe('success');

    const balanceAfter = await readVaultBalance(deployed.vaultAddress, wallet.address);
    expect(balanceAfter - balanceBefore).toBe(depositAmount);
  });
});
