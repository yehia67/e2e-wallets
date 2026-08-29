import { existsSync } from 'node:fs';
import { queueWalletTrigger } from '@wallets-e2e/core/bdd';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { loadDeployedContracts, readVaultBalance, deployedContractsPath } from './contracts.js';
import { expect, Given, Then, When, test } from './fixtures.js';

const DEPLOYED_PATH = deployedContractsPath;

let vaultBalanceBefore: bigint | null = null;

Given('I am connected to MetaMask on Sepolia', async ({ context, page }) => {
  if (existsSync(DEPLOYED_PATH)) {
    const deployed = loadDeployedContracts();
    vaultBalanceBefore = await readVaultBalance(deployed.vaultAddress, wallet.address);
  } else {
    vaultBalanceBefore = null;
  }

  await metamaskDriver.importWallet(context, wallet.seedPhrase);
  await metamaskDriver.switchToTestnetNetwork?.(context);
  if (page.url() === 'about:blank') {
    await page.goto('/');
  }
  await metamaskDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
  });
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

Then('my vault balance increased by one token', async () => {
  if (!existsSync(DEPLOYED_PATH)) {
    test.skip();
  }
  const deployed = loadDeployedContracts();
  const depositAmount = BigInt(deployed.depositAmount);
  const balanceAfter = await readVaultBalance(deployed.vaultAddress, wallet.address);
  if (vaultBalanceBefore === null) {
    throw new Error('vaultBalanceBefore not set — run Given I am connected to MetaMask on Sepolia first');
  }
  expect(balanceAfter - vaultBalanceBefore).toBe(depositAmount);
});
