/**
 * Single-session README demo: unlock → Sepolia → connect → ETH transfer → ERC20 approve → deposit.
 * Only runs when WALLETS_E2E_RECORD_DEMO=1 (wallets/metamask/scripts/record-demo-gif.sh).
 * Do not generate a GIF from connect-only or partial runs.
 */
import { SEPOLIA_RPC_URL, waitForEthTransactionMined } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';
import { loadDeployedContracts, readVaultBalance } from './contracts.js';

const isDemoRecording = process.env.WALLETS_E2E_RECORD_DEMO === '1';

test.describe('README demo recording', () => {
  test.skip(!isDemoRecording, 'Only run via wallets/metamask/scripts/record-demo-gif.sh');

  test('unlock → Sepolia → connect → ETH send → ERC20 approve deposit', async ({ extensionContext }) => {
    test.setTimeout(15 * 60 * 1000);

    const deployed = loadDeployedContracts();
    const depositAmount = BigInt(deployed.depositAmount);

    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    await metamaskDriver.switchToTestnetNetwork?.(extensionContext);

    const appPage = await extensionContext.newPage();
    await appPage.goto('/');
    await appPage.waitForLoadState('domcontentloaded');
    await expect(appPage.getByTestId('connect-wallet')).toBeVisible({ timeout: 15_000 });

    await metamaskDriver.connectToDapp(extensionContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
    });
    await expect(appPage.getByTestId('connected-address')).toContainText(wallet.address, {
      timeout: 15_000,
      ignoreCase: true,
    });

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
        rpcUrl: SEPOLIA_RPC_URL,
        timeoutMs: 8 * 60 * 1000,
      }),
    ).toBe('success');

    const vaultBalanceBefore = await readVaultBalance(deployed.vaultAddress, wallet.address);

    await metamaskDriver.confirmTransaction(extensionContext, async () => {
      await appPage.getByTestId('approve-token').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toContainText(/^approve-tx:0x/i, { timeout: 30_000 });

    await metamaskDriver.confirmTransaction(extensionContext, async () => {
      await appPage.getByTestId('deposit-after-approve').click();
    });
    await expect(appPage.getByTestId('deposit-status')).toContainText(/^deposit-tx:0x/i, { timeout: 30_000 });

    const depositStatus = await appPage.getByTestId('deposit-status').innerText();
    const depositTxHash = depositStatus.replace(/^deposit-tx:/i, '').trim();
    expect(
      await waitForEthTransactionMined(depositTxHash, {
        rpcUrl: SEPOLIA_RPC_URL,
        timeoutMs: 8 * 60 * 1000,
      }),
    ).toBe('success');

    const vaultBalanceAfter = await readVaultBalance(deployed.vaultAddress, wallet.address);
    expect(vaultBalanceAfter - vaultBalanceBefore).toBe(depositAmount);
  });
});
