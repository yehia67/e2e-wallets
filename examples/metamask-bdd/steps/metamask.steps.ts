import { existsSync } from 'node:fs';
import {
  EVM_NETWORKS,
  createInjectedEvmRpc,
  waitForEthTransactionMined,
  type EvmNetwork,
  type EvmRpcRequester,
} from '@wallets-e2e/core';
import { queueWalletTrigger, takeWalletTrigger } from '@wallets-e2e/core/bdd';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { loadDeployedContracts, readVaultBalance, deployedContractsPath } from './contracts.js';
import { expect, Given, Then, When, test } from './fixtures.js';

const DEPLOYED_PATH = deployedContractsPath;

let vaultBalanceBefore: bigint | null = null;
let rpcRequester: EvmRpcRequester | null = null;

/**
 * The networks a `.feature` sentence may name, keyed by the word a human writes. The Gherkin says
 * "Sepolia"; the driver is handed the whole `EvmNetwork` value, so adding another network here is
 * a one-line data change rather than new step code.
 */
const NETWORKS_BY_WORD: Readonly<Record<string, EvmNetwork>> = {
  sepolia: EVM_NETWORKS.sepolia,
  mainnet: EVM_NETWORKS.mainnet,
  localhost: EVM_NETWORKS.localhost,
};

Given('I am connected to MetaMask on {word}', async ({ context, page }, networkWord: string) => {
  const network = Object.hasOwn(NETWORKS_BY_WORD, networkWord.trim().toLowerCase())
    ? NETWORKS_BY_WORD[networkWord.trim().toLowerCase()]
    : undefined;
  if (!network) {
    throw new Error(
      `Unknown network "${networkWord}" in a MetaMask step. ` +
        `Valid networks: ${Object.keys(NETWORKS_BY_WORD).join(', ')}.`,
    );
  }

  await metamaskDriver.importWallet(context, wallet.seedPhrase);
  if (page.url() === 'about:blank') {
    await page.goto('/');
  }
  await metamaskDriver.switchNetwork?.(context, network);
  await metamaskDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
  });
  rpcRequester = createInjectedEvmRpc(page);
  if (existsSync(DEPLOYED_PATH)) {
    const deployed = loadDeployedContracts();
    vaultBalanceBefore = await readVaultBalance(
      deployed.vaultAddress,
      wallet.address,
      rpcRequester,
    );
  } else {
    vaultBalanceBefore = null;
  }
});

Then('my wallet address is shown', async ({ page }) => {
  const text = await page.getByTestId('connected-address').innerText();
  expect(text.toLowerCase()).toBe(wallet.address.toLowerCase());
});

When('I request ERC20 token approval', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('approve-token').click();
  });
});

When('I approve the token permission popup', async ({ context }) => {
  await metamaskDriver.approveTokenPermission(context, takeWalletTrigger(context));
});

When('I request an ERC20 deposit after approve', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('deposit-after-approve').click();
  });
});

When('I request an ERC20 permit signature', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('deposit-permit-sign').click();
  });
});

When('I request an ERC20 deposit with permit', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('deposit-permit-submit').click();
  });
});

Then('the EVM transaction is mined', async ({ page }) => {
  if (!rpcRequester) {
    throw new Error('Injected RPC requester missing — connect MetaMask before waiting for a receipt.');
  }
  const status = await page.getByTestId('deposit-status').innerText();
  const txHash = status.match(/(?:approve|deposit|permit-deposit)-tx:(0x[0-9a-f]{64})/i)?.[1];
  if (!txHash) {
    throw new Error(`Expected an EVM transaction hash in deposit status, got: ${status}`);
  }
  expect(
    await waitForEthTransactionMined(txHash, {
      requester: rpcRequester,
      timeoutMs: 8 * 60 * 1000,
    }),
  ).toBe('success');
});

Then('my vault balance increased by one token', async () => {
  if (!existsSync(DEPLOYED_PATH)) {
    test.skip();
  }
  const deployed = loadDeployedContracts();
  const depositAmount = BigInt(deployed.depositAmount);
  const balanceAfter = await readVaultBalance(
    deployed.vaultAddress,
    wallet.address,
    rpcRequester ?? undefined,
  );
  if (vaultBalanceBefore === null) {
    throw new Error('vaultBalanceBefore not set — run "Given I am connected to MetaMask on <network>" first');
  }
  expect(balanceAfter - vaultBalanceBefore).toBe(depositAmount);
});
