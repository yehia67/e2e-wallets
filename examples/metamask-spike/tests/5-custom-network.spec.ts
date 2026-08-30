import { EVM_NETWORKS, chainIdToHex, type EvmNetwork } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';

const CUSTOM: EvmNetwork = EVM_NETWORKS.baseSepolia;

test('a user-defined custom network is added and selected for the dapp', async ({ extensionContext }) => {
  test.setTimeout(5 * 60 * 1000);

  await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
  const dapp = await extensionContext.newPage();
  await dapp.goto('/');
  await metamaskDriver.switchNetwork?.(extensionContext, CUSTOM);
  await metamaskDriver.connectToDapp(extensionContext, async () => {
    await dapp.evaluate(() => {
      const provider = (window as unknown as {
        ethereum?: { request(a: unknown): Promise<unknown> };
      }).ethereum;
      void provider?.request({ method: 'eth_requestAccounts' });
    });
  });

  const chainId = await dapp.evaluate(
    async () =>
      (await (window as unknown as { ethereum?: { request: (a: unknown) => Promise<string> } }).ethereum?.request({
        method: 'eth_chainId',
      })) ?? '',
  );
  expect(chainId.toLowerCase()).toBe(chainIdToHex(CUSTOM.chainId));
});
