---
name: wallets-e2e
description: Use when writing, running, or debugging a Playwright E2E test that needs a real Stacks wallet browser extension (Leather) -- unlocking it, approving a dapp connection, signing a message, sending a real STX transfer, or calling a smart contract. Also covers Gherkin/BDD `.feature` files for those flows via @wallets-e2e/core/bdd and playwright-bdd. Covers @wallets-e2e/core and @wallets-e2e/leather.
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
- `leatherDriver.switchNetwork?.(context, 'testnet4')` -- **call this before any real transfer or contract call.** Leather defaults to mainnet regardless of what network your `request()` call names; an account with no mainnet balance crashes Leather's fee-estimation step outright, before any UI even renders. The network is an argument, so the same port verb serves every chain (MetaMask's driver takes an `EvmNetwork` value here). Optional-chained because not every wallet driver may need an explicit network-switch step.
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
  await leatherDriver.switchNetwork?.(context, 'testnet4');

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
- **Every dapp-side click that opens a wallet popup MUST happen inside the `trigger()` callback.** `connectToDapp` and `confirmTransaction` both register `context.waitForEvent('page')` *before* awaiting `trigger()`. Click the dapp's button before calling the driver -- or in an earlier BDD step -- and the popup opens with nobody listening: you get a bare 10-second timeout, which looks like a broken extension and isn't. This is the single most common way to misuse this package.

## Gherkin / `.feature` files (BDD)

`@wallets-e2e/core/bdd` ships ready-made wallet step definitions so a `.feature` file contains only the dapp's own language -- no seed phrase, no network switching, no extension paths, no popup mechanics.

```bash
npm install --save-dev playwright-bdd
```

`playwright-bdd` is an **optional** peer dependency: importing `@wallets-e2e/core` never requires it, only the `@wallets-e2e/core/bdd` subpath does. **Use `playwright-bdd`, never `@cucumber/cucumber`** -- cucumber-js ships its own runner and World and cannot consume Playwright fixtures, so the extension context can't reach the steps.

Steps shipped by the package:

| Step | What it does |
|---|---|
| `Given I am connected to {chain} {network}` | Imports the wallet from the seed, switches network, and connects the dapp -- **one coarse step on purpose** |
| `When I approve the wallet popup` | Runs the queued dapp action inside `confirmTransaction`'s `trigger()` and approves the popup |
| `Then the transaction is mined` | Polls the Stacks API for the recorded txid; fails on `abort_by_*` or timeout. **Spends real testnet STX and waits on a real block (~10 min).** Its default poll allows 15 minutes -- above any sane Playwright timeout -- so the scenario needs a `@timeout:` tag (e.g. `@timeout:1_200_000`) or Playwright kills the test first |

`Given I am connected to Stacks testnet` resolves the word `testnet` to `testnet4`. Only `mainnet`, `testnet` and `testnet4` are accepted: these steps hand `switchNetwork()` a Stacks network word, and those are the only ones Leather's own picker is proven against. `devnet`/`signet`/`testnet3` are rejected with a distinct "not supported yet" message rather than silently landing on testnet4, and an unknown word throws before anything launches, listing what's valid.

```ts
// steps/fixtures.ts -- note `test` comes from playwright-bdd, not @playwright/test
import { test as base } from 'playwright-bdd';
import { launchContext } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { leatherDriver } from '@wallets-e2e/leather';

export const test = base.extend({
  // The steps read the STOCK `context`/`page` fixtures -- override them, don't add new names.
  context: async ({}, use) => {
    const context = await launchContext({ extensionPath, userDataDir, recordVideoDir });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => use(await context.newPage()),
});

// `test`, `driver`, `seedPhrase` and `walletName` are all required -- omitting `test` would bind
// the steps to Playwright's stock fixtures, whose context has no extension in it.
export const { Given, When, Then } = createWalletSteps({
  test,
  driver: leatherDriver,
  seedPhrase: process.env.WALLETS_E2E_SEED_PHRASE!,
  walletName: 'Leather',        // as @stacks/connect's picker lists it
  connectTestId: 'connect-wallet', // your dapp's own connect button
});
```

**Your own dapp steps must queue their click, never perform it** -- that is how `When I approve the wallet popup` stays safe (see the trigger-callback gotcha above):

```ts
import { queueWalletTrigger, recordTransactionId } from '@wallets-e2e/core/bdd';

When('I request a transfer of 1 STX', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('send-stx').click(); // runs INSIDE trigger(), not here
  });
});

Then('a transaction id is shown', async ({ context, page }) => {
  const txid = (await page.getByTestId('transfer-txid').innerText()).replace(/^txid:\s*/, '').trim();
  recordTransactionId(context, txid); // feeds `Then the transaction is mined`
});
```

Wire the runner with `defineBddConfig` and run `bddgen && playwright test`. Include the fixtures file in the `steps` glob -- it exports the `test` the generated specs import. A real, passing setup lives in `examples/bdd/` in this repo.

## Fixture / test-account wallets

Real account secret keys should never be hardcoded as the only option. This package's own fixture (`@wallets-e2e/leather/fixtures/wallet.js`) reads `WALLETS_E2E_SEED_PHRASE` / `WALLETS_E2E_MAINNET_ADDRESS` / `WALLETS_E2E_TESTNET_ADDRESS` from the environment first, falling back to a safe, no-value default. Follow the same pattern for any project-specific fixture wallet: env var first, checked-in throwaway default second, never a real-value key in source.

## What this package does NOT do (don't assume it)

- No Xverse or other wallet support yet -- Leather only.
- No headless execution proven yet -- run headed (`headless: false`, the default).

## Published packages

- [`@wallets-e2e/core`](https://www.npmjs.com/package/@wallets-e2e/core)
- [`@wallets-e2e/leather`](https://www.npmjs.com/package/@wallets-e2e/leather)
- Source: [github.com/yehia67/e2e-wallets](https://github.com/yehia67/e2e-wallets)
