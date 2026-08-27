import { queueWalletTrigger, recordTransactionId } from '@wallets-e2e/core/bdd';
import { expect, Then, When } from './fixtures.js';

/**
 * The dapp-language half of the step library: everything here is specific to
 * `examples/react-connect`'s UI. The wallet half — importing the seed, switching network,
 * approving the popup, confirming the transaction on-chain — comes from `@wallets-e2e/core/bdd`
 * and is never re-implemented here.
 */

Then('my wallet address is shown', async ({ page }) => {
  await expect(page.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });
});

When('I request a transfer of 1 STX', async ({ context, page }) => {
  // Deliberately does NOT click. The click is queued so `I approve the wallet popup` can run it
  // inside the driver's `trigger()` callback — the driver starts listening for the popup *before*
  // awaiting that callback, so a click performed here would open the popup with nobody listening
  // and die on a 10-second timeout.
  queueWalletTrigger(context, async () => {
    await page.getByTestId('send-stx').click();
  });
});

Then('a transaction id is shown', async ({ context, page }) => {
  await expect(page.getByTestId('transfer-txid')).toBeVisible({ timeout: 15_000 });
  const text = await page.getByTestId('transfer-txid').innerText();
  const txid = text.replace(/^txid:\s*/, '').trim();
  // @stacks/connect's stx_transferStx result returns the txid without a "0x" prefix.
  expect(txid).toMatch(/^[0-9a-f]{64}$/i);

  // Hand it to the wallet library's `the transaction is mined` step — which element carries the
  // txid is this dapp's knowledge, not the library's.
  recordTransactionId(context, txid);
});
