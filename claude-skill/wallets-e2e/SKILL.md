---
name: wallets-e2e
description: Use when writing, running, or debugging a Playwright E2E test that needs a real Stacks wallet browser extension (Leather) -- unlocking it, approving a dapp connection, signing a message, sending a real STX transfer, or calling a smart contract. Covers @wallets-e2e/core and @wallets-e2e/leather.
---

# wallets-e2e

Drives a **real**, source-built Leather browser extension inside a Playwright test -- real unlock, real popup approval, real signature, real on-chain transaction. Nothing here is mocked; do not write a mock wallet object when this package is available.

## Install

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/leather @playwright/test
```

`@playwright/test` is a **peer dependency** of both packages -- the consuming project's own Playwright install is what's used, not a bundled copy.

Before running any test, the real extension must be built from source once (idempotent -- skips if already built):

```bash
git clone --depth 1 https://github.com/leather-io/extension.git /tmp/leather-source
cd /tmp/leather-source && pnpm install && pnpm prepare && pnpm build
cp -R dist /path/to/your/project/wallets/leather/dist
```

(If the consuming repo already vendors this pattern -- e.g. it's this very monorepo -- just run `pnpm build:leather` instead of the manual clone above.)

## The core API

```ts
import { launchContext, resolveExtensionId, selectWalletInStacksConnectModal, waitForTransactionMined, TESTNET_RPC_URL } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
```

- `launchContext({ extensionPath, userDataDir, recordVideoDir, headless? })` -- the ONE place a persistent Chromium context with the extension loaded gets created. Never call `chromium.launch`/`launchPersistentContext` directly when this package is available.
- `leatherDriver.importWallet(context, seedPhrase)` -- unlocks Leather via an existing seed phrase. Returns `{ address }` (the mainnet-form address, since that's what Leather's own persisted storage actually surfaces).
- `leatherDriver.switchToTestnetNetwork?.(context)` -- **call this before any real transfer or contract call.** Leather defaults to mainnet regardless of what network your `request()` call names; an account with no mainnet balance crashes Leather's fee-estimation step outright, before any UI even renders. Optional-chained because not every wallet driver may need an explicit network-switch step.
- `leatherDriver.connectToDapp(context, trigger)` -- `trigger` is entirely your job: click your dapp's own "Connect Wallet" button, then call `selectWalletInStacksConnectModal(page, 'Leather')` to pick Leather in `@stacks/connect`'s own in-page wallet picker (that picker is `@stacks/connect`'s UI, not Leather's -- this helper lives in `core`, not the driver, for that reason).
- `leatherDriver.confirmTransaction(context, trigger)` -- approves *any* popup requesting a signature or transaction (a signed message, a transfer, a contract call -- same method, no special-casing needed). `trigger` is whatever dapp-side action opens that popup.
- `waitForTransactionMined(txid, { rpcUrl?, timeoutMs?, pollIntervalMs? })` -- polls a Stacks API until the transaction is `success` or `abort_by_*`. Default `rpcUrl` is `TESTNET_RPC_URL`. **Never treat "the popup closed" as proof a transaction landed** -- always confirm via this function for a real transfer or contract call.

## A complete example

```ts
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal, waitForTransactionMined, TESTNET_RPC_URL } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';

test('sends a real STX transfer', async () => {
  const context = await launchContext({
    extensionPath: 'wallets/leather/dist',
    userDataDir: '.tmp/leather-profile',
    recordVideoDir: 'test-results/videos',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000');

  await leatherDriver.importWallet(context, process.env.WALLETS_E2E_SEED_PHRASE!);
  await leatherDriver.switchToTestnetNetwork?.(context);

  await leatherDriver.connectToDapp(context, async () => {
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await selectWalletInStacksConnectModal(page, 'Leather');
  });

  await leatherDriver.confirmTransaction(context, async () => {
    await page.getByRole('button', { name: 'Send STX' }).click(); // your dapp's own trigger
  });

  const txid = await page.getByTestId('txid').innerText();
  const status = await waitForTransactionMined(txid, { rpcUrl: TESTNET_RPC_URL, timeoutMs: 15 * 60 * 1000 });
  expect(status).toBe('success');

  await context.close();
});
```

## Real gotchas (hit and fixed in this package's own test suite -- don't rediscover these)

- **Stacks memo fields are a fixed 34-byte buffer.** A `request('stx_transferStx', { memo: '...' })` call with a memo over 34 characters makes Leather's fee-estimation step throw *before any popup UI renders at all* ("Error generating unsigned stacks transaction"). This looks exactly like an external wallet bug -- it isn't. Check your memo length first.
- **`signMessage()` from `@stacks/connect` is deprecated and a literal no-op.** Use `request('stx_signMessage', { message })` instead, which resolves to `{ signature, publicKey }`.
- **`connect()`'s `addresses` array has no guaranteed order.** It returns multiple entries (Bitcoin formats plus one Stacks address) -- filter explicitly: `response.addresses.find(a => a.symbol === 'STX')`.
- **Leather's approval popup button label changes by request type**: "Sign" for a plain message, "Approve" for a real transaction or contract call. Neither has a stable `data-testid`. `confirmTransaction` already handles both; don't hardcode one label if driving the popup directly.
- **A local Clarinet devnet is not a safe assumption.** Two independent, real Clarinet 3.23.1 bugs (a permanent chain stall a few minutes after every boot; contract deploys that can't land before that stall) make it unusable for this kind of testing today. This package targets real Stacks testnet by default (`TESTNET_RPC_URL`).
- **`page.waitForFunction(fn, options)` silently drops `options` into the unused `arg` slot** -- the real signature is `(fn, arg, options)`. Always pass `waitForFunction(fn, undefined, options)` if writing this pattern yourself.

## Fixture / test-account wallets

Real account secret keys should never be hardcoded as the only option. This package's own fixture (`@wallets-e2e/leather/fixtures/wallet.js`) reads `WALLETS_E2E_SEED_PHRASE` / `WALLETS_E2E_MAINNET_ADDRESS` / `WALLETS_E2E_TESTNET_ADDRESS` from the environment first, falling back to a safe, no-value default. Follow the same pattern for any project-specific fixture wallet: env var first, checked-in throwaway default second, never a real-value key in source.

## What this package does NOT do (don't assume it)

- No Xverse or other wallet support yet -- Leather only.
- No headless execution proven yet -- run headed (`headless: false`, the default).

## Published packages

- [`@wallets-e2e/core`](https://www.npmjs.com/package/@wallets-e2e/core)
- [`@wallets-e2e/leather`](https://www.npmjs.com/package/@wallets-e2e/leather)
- Source: [github.com/yehia67/e2e-wallets](https://github.com/yehia67/e2e-wallets)
