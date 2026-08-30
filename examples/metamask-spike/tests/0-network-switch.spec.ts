/**
 * Focused MetaMask network switch — the blocker for connect/send.
 * Run alone: WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm exec playwright test tests/0-network-switch.spec.ts
 *
 * The network is data here, not identity: swap `TARGET_NETWORK` for any other `EvmNetwork` and the
 * same driver call has to work — a built-in chain uses its bundled provider, while a custom chain
 * is validated, added, and selected.
 */
import { EVM_NETWORKS, chainIdToHex } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';

const TARGET_NETWORK = EVM_NETWORKS.sepolia;

test(`applies ${TARGET_NETWORK.name} to the connected dapp origin`, async ({ extensionContext }) => {
  test.setTimeout(3 * 60 * 1000);

  await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
  const dapp = await extensionContext.newPage();
  await dapp.goto('/');
  await metamaskDriver.switchNetwork?.(extensionContext, TARGET_NETWORK);
  await metamaskDriver.connectToDapp(extensionContext, async () => {
    await dapp.getByTestId('connect-wallet').click();
  });

  // MetaMask's multichain home is an asset filter; the dapp provider is the authoritative signal.
  const chainId = await dapp.evaluate(
    async () =>
      (await (window as unknown as { ethereum?: { request: (a: unknown) => Promise<string> } }).ethereum?.request({
        method: 'eth_chainId',
      })) ?? '',
  );
  expect(chainId.toLowerCase()).toBe(chainIdToHex(TARGET_NETWORK.chainId));
  await expect(dapp.getByTestId('connected-address')).toContainText(wallet.address, {
    ignoreCase: true,
  });
});
