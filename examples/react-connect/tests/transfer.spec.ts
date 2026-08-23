import { TESTNET_RPC_URL, waitForTransactionMined } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { test, expect } from './fixtures.js';

test.describe('Story 1.4: sending a real STX transfer', () => {
  test('a signed STX transfer is confirmed mined on real testnet', async ({ connectedAppOnTestnet }) => {
    // Real testnet block times run ~10 minutes -- this test's own timeout must cover that, well
    // above the 120s default set for every other (popup-only) test in this suite.
    test.setTimeout(20 * 60 * 1000);

    // Fixture wallet must already hold real testnet STX before this test runs:
    //   node scripts/fund-fixture-wallet-testnet.mjs
    // The faucet is rate-limited, so this isn't run automatically as part of every test.

    const { context, appPage } = connectedAppOnTestnet;
    let txid = '';

    await test.step('trigger a real transfer and approve it in the real popup', async () => {
      // FR5/FR6-equivalent: trigger a real transfer, approve it in the real popup, then confirm
      // via RPC that it actually landed on-chain -- not merely that the popup closed.
      await leatherDriver.confirmTransaction(context, async () => {
        await appPage.getByTestId('send-stx').click();
      });

      await expect(appPage.getByTestId('transfer-txid')).toBeVisible({ timeout: 15_000 });
      const text = await appPage.getByTestId('transfer-txid').innerText();
      txid = text.replace(/^txid:\s*/, '').trim();
      // @stacks/connect's stx_transferStx result returns the txid without a "0x" prefix.
      expect(txid).toMatch(/^[0-9a-f]{64}$/i);
    });

    await test.step('confirm the transaction actually landed on-chain via RPC', async () => {
      // Real testnet block times run ~10 minutes -- a generous timeout, not a bug.
      const status = await waitForTransactionMined(txid, { rpcUrl: TESTNET_RPC_URL, timeoutMs: 15 * 60 * 1000 });
      expect(status).toBe('success');
    });
  });
});
