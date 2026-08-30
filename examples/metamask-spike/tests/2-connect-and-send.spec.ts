import {
  EVM_NETWORKS,
  createInjectedEvmRpc,
  waitForEthTransactionMined,
} from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';

/** The network under test — an argument to the driver, not baked into it. */
const NETWORK = EVM_NETWORKS.sepolia;

test.describe(`connecting the spike dapp to MetaMask on ${NETWORK.name}`, () => {
  test('connects and shows the fixture address on the dapp page', async ({ extensionContext }) => {
    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    const appPage = await extensionContext.newPage();
    await appPage.goto('/');
    await metamaskDriver.switchNetwork?.(extensionContext, NETWORK);

    await metamaskDriver.connectToDapp(extensionContext, async () => {
      await appPage.getByTestId('connect-wallet').click();
    });

    await expect(appPage.getByTestId('connected-address')).toHaveText(wallet.address, {
      ignoreCase: true,
    });
  });

  test('I/O matrix: a trigger that never reaches the real popup throws', async ({ extensionContext }) => {
    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    await expect(metamaskDriver.connectToDapp(extensionContext, async () => {})).rejects.toThrow();
  });
});

test.describe(`sending ${NETWORK.name} ETH from the spike dapp`, () => {
  test('approves a 0.0001 ETH self-transfer and confirms it mined', async ({ extensionContext }) => {
    test.skip(
      process.env.WALLETS_E2E_RUN_SEPOLIA !== '1',
      'Set WALLETS_E2E_RUN_SEPOLIA=1 to authorize a gas-spending Sepolia test.',
    );
    test.setTimeout(10 * 60 * 1000);

    await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
    const appPage = await extensionContext.newPage();
    await appPage.goto('/');
    await metamaskDriver.switchNetwork?.(extensionContext, NETWORK);

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
      requester: createInjectedEvmRpc(appPage),
      timeoutMs: 8 * 60 * 1000,
    });
    expect(status).toBe('success');
  });
});
