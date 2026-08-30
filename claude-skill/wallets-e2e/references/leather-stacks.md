# Leather and Stacks flows

Use `@wallets-e2e/leather` with a real source-built Leather extension. The driver implements
`WalletDriver<SupportedStacksNetwork>` for `mainnet` and `testnet4`.

Package: <https://www.npmjs.com/package/@wallets-e2e/leather>
Core dependency: <https://www.npmjs.com/package/@wallets-e2e/core>

Read [setup-and-reporting.md](setup-and-reporting.md) before choosing a published Leather/core
version pair. Do not substitute toolkit source for a missing public package capability.

## Basic flow

```ts
import { expect } from '@playwright/test';
import {
  selectWalletInStacksConnectModal,
  waitForTransactionMined,
  TESTNET_RPC_URL,
} from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
import { test } from './fixtures.js';

test('connects and submits a Stacks transaction', async ({ extensionContext: context, page }) => {
  await page.goto('/');
  const account = await leatherDriver.importWallet(context, wallet.seedPhrase);
  expect(account.address).toBe(wallet.mainnetAddress);

  await leatherDriver.switchToTestnetNetwork?.(context);
  await leatherDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
    await selectWalletInStacksConnectModal(page, 'Leather');
  });

  await leatherDriver.confirmTransaction(context, async () => {
    await page.getByTestId('send-stx').click();
  });

  const txid = (await page.getByTestId('transfer-txid').innerText())
    .replace(/^txid:\s*/, '')
    .trim();
  expect(txid).toMatch(/^(?:0x)?[0-9a-f]{64}$/i);
  expect(
    await waitForTransactionMined(txid, {
      rpcUrl: TESTNET_RPC_URL,
      timeoutMs: 15 * 60_000,
    }),
  ).toBe('success');
});
```

`@stacks/connect` renders its own in-page wallet picker before Leather opens. Selecting Leather is
dapp integration logic, so use `selectWalletInStacksConnectModal(page, 'Leather')` inside the
connection trigger.

## Transaction and signature behavior

Leather uses `confirmTransaction` for a message-signature popup, STX transfer, and contract call. Its
button text changes by request type (`Sign` or `Approve`); the driver handles both.

Always select the network before a real transfer or contract call. Leather otherwise defaults to
mainnet even if the dapp request describes another network, and fee estimation can fail before a
popup renders.

For Stacks requests:

- Use `request('stx_signMessage', { message })`; the deprecated `signMessage()` helper is a no-op.
- Filter the result of `connect()` by `symbol === 'STX'`. Address array order is not guaranteed.
- A transfer memo is a fixed 34-byte field. Longer text makes transaction construction fail before
  wallet approval UI appears.
- Contract calls use `stx_callContract` and real `ClarityValue` arguments.
- Popup closure is not mining. Poll with `waitForTransactionMined`; fail on `abort_by_response`,
  `abort_by_post_condition`, other non-success statuses, or timeout.

Leather's persisted unlocked address is normally the mainnet-form address even when the wallet later
switches to testnet. Keep independently derived mainnet and testnet fixture addresses and assert the
form appropriate to the API/UI being checked.

## Network and timing constraints

`StacksNetwork` includes `mainnet`, `testnet4`, `testnet3`, `signet`, and `devnet`, but the current
driver-supported subset is `mainnet | testnet4`. The word `testnet` in package BDD steps resolves to
`testnet4`; unsupported real names fail clearly instead of silently mapping.

Published Leather `0.1.3` exposes `switchToTestnetNetwork`. A later compatible release exposes the
typed `switchNetwork(context, 'testnet4')`; use it only after verifying that export in the installed
package.

Real Stacks testnet blocks can take many minutes. Size both the receipt timeout and Playwright test
timeout; a 15-minute receipt poll under a 2-minute test timeout will always be killed by Playwright.
Do not respond to slow blocks by removing the mined assertion.

This project uses real Stacks testnet for chain-facing acceptance tests. Do not assume a local
Clarinet devnet is interchangeable without first proving its lifecycle and deployment behavior in
the consuming repository.
