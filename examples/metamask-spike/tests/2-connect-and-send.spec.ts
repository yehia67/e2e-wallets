import { SEPOLIA_RPC_URL, waitForEthTransactionMined } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';

test.describe('connecting the spike dapp to MetaMask on Sepolia', () => {
  test('connects and shows the fixture address on the dapp page', async ({ extensionContext }) => {
    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    await metamaskDriver.switchToTestnetNetwork?.(extensionContext);

    const appPage = await extensionContext.newPage();
    await appPage.goto('/');

    await metamaskDriver.connectToDapp(extensionContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
    });

    const text = await appPage.getByTestId('connected-address').innerText();
    expect(text.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  test('I/O matrix: a trigger that never reaches the real popup throws', async ({ extensionContext }) => {
    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    await expect(metamaskDriver.connectToDapp(extensionContext, async () => {})).rejects.toThrow();
  });
});

test.describe('sending Sepolia ETH from the spike dapp', () => {
  test('approves a 0.0001 ETH self-transfer and confirms it mined', async ({ extensionContext }) => {
    test.setTimeout(10 * 60 * 1000);

    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    await metamaskDriver.switchToTestnetNetwork?.(extensionContext);

    const appPage = await extensionContext.newPage();
    await appPage.goto('/');

    await metamaskDriver.connectToDapp(extensionContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
    });
    await expect(appPage.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });

    await metamaskDriver.confirmTransaction(extensionContext, async () => {
      await appPage.getByTestId('send-eth').click();
    });

    await expect(appPage.getByTestId('tx-hash')).toBeVisible({ timeout: 30_000 });
    const txHash = (await appPage.getByTestId('tx-hash').innerText()).trim();
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);

    const status = await waitForEthTransactionMined(txHash, {
      rpcUrl: SEPOLIA_RPC_URL,
      timeoutMs: 8 * 60 * 1000,
    });
    expect(status).toBe('success');
  });
});
