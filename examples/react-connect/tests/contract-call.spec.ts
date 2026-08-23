import { TESTNET_RPC_URL, waitForTransactionMined } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { test, expect } from './fixtures.js';

test.describe('a real smart-contract call', () => {
  test('is confirmed mined on real testnet', async ({ connectedAppOnTestnet }) => {
    // Real testnet block times run ~10 minutes.
    test.setTimeout(20 * 60 * 1000);

    // contracts/counter.clar must already be deployed to testnet:
    //   node scripts/deploy-counter-testnet.mjs
    // Fixture wallet must already hold real testnet STX:
    //   node examples/react-connect/scripts/fund-fixture-wallet-testnet.mjs

    const { context, appPage } = connectedAppOnTestnet;
    let txid = '';

    await test.step('trigger a real contract call and approve it in the real popup', async () => {
      // A real smart-contract function call, approved via the real Leather popup, then confirmed
      // via RPC that it actually landed on-chain -- not merely that the popup closed.
      await leatherDriver.confirmTransaction(context, async () => {
        await appPage.getByTestId('call-contract').click();
      });

      await expect(appPage.getByTestId('contract-call-txid')).toBeVisible({ timeout: 15_000 });
      const text = await appPage.getByTestId('contract-call-txid').innerText();
      txid = text.replace(/^txid:\s*/, '').trim();
      expect(txid).toMatch(/^[0-9a-f]{64}$/i);
    });

    await test.step('confirm the call actually landed on-chain via RPC', async () => {
      const status = await waitForTransactionMined(txid, { rpcUrl: TESTNET_RPC_URL, timeoutMs: 15 * 60 * 1000 });
      expect(status).toBe('success');
    });
  });
});
