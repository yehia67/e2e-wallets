# Quick Start: testing your Stacks dapp against a real Leather wallet

`wallets-e2e` lets you drive a **real** Leather browser extension from a Playwright test against your own dapp — real unlock, real connection-approval, real transaction-signing, no mocked wallet object standing in for the real thing. Nothing like this existed for Stacks wallets before.

**Honest status up front:** unlocking a wallet, connecting to a dapp, signing a message, sending a real signed STX transfer, and calling a real deployed smart contract all work today, end to end, against the real extension — confirmed on real Stacks testnet. Xverse support isn't implemented yet — see [What's not here yet](#whats-not-here-yet) below.

This is strictly a **package-consumer tutorial**. Every toolkit import comes from an installed
`@wallets-e2e/*` entrypoint. It does not require a checkout, workspace dependency, local package
link, or toolkit source file. The first example uses the currently published `0.1.3` API.

## A real, working example

```ts
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

test('user connects and signs a message', async ({}, testInfo) => {
  const context = await launchContext({
    extensionPath:
      process.env.LEATHER_EXTENSION_PATH ?? '.wallet-extensions/leather/dist',
    userDataDir: '',
    recordVideoDir: testInfo.outputPath('videos'),
  });

  try {
    const page = await context.newPage();
    await page.goto('http://localhost:3000'); // your dapp, running locally
    await leatherDriver.importWallet(context, wallet.seedPhrase);
    await leatherDriver.switchToTestnetNetwork?.(context);

    await leatherDriver.connectToDapp(context, async () => {
      await page.getByRole('button', { name: 'Connect Wallet' }).click();
      await selectWalletInStacksConnectModal(page, 'Leather');
    });

    await leatherDriver.confirmTransaction(context, async () => {
      await page.getByRole('button', { name: 'Sign Message' }).click();
    });

    await expect(page.getByText(/signature/i)).toBeVisible();
  } finally {
    await context.close();
  }
});
```

The test uses only package entrypoints. The selectors and dapp URL are deliberately caller-owned:
replace them with the stable selectors and server URL in your application.

Prefer Gherkin `.feature` files so product owners can review the scenarios without reading TypeScript? That path is documented separately in [`feature-files.md`](./feature-files.md) — same real Leather extension, same popup rules, different surface.

Want the video, trace and popup screenshots of a run in an HTML report? See [`reports-and-artifacts.md`](./reports-and-artifacts.md) — it covers what `createExtensionTest` attaches, what Playwright attaches itself, and the retention modes for each.

## `confirmTransaction` on its own

`confirmTransaction` isn't special-cased to "sign a plain message" — it approves *any* popup that opens for a signature/transaction request, once a wallet is already connected. A dapp that asks for several approvals in one session (e.g. multiple signed actions) calls it once per popup:

```ts
// Already connected from earlier in the test — no need to re-run connectToDapp.
await leatherDriver.confirmTransaction(context, async () => {
  await page.getByRole('button', { name: 'Sign Message' }).click();
});
const firstSignature = await page.getByTestId('signature-result').innerText();

// A second, independent approval — same driver call, same pattern, whatever button your dapp
// uses to request it.
await leatherDriver.confirmTransaction(context, async () => {
  await page.getByRole('button', { name: 'Sign Another Thing' }).click();
});
```

The `trigger` callback is the only thing that changes per call — it is whatever your dapp does to
open the next popup. `confirmTransaction` does not care what kind of approval it is, only that a real
Leather popup opens, gets approved, and closes cleanly. A trigger that opens no popup fails quickly
instead of waiting for the entire test timeout.

One real wrinkle: Leather's approval button's label changes depending on what's being approved — "Sign" for a plain message, "Approve" for a real transaction. `confirmTransaction` already matches either, but if you're driving Leather's popup yourself outside this project's driver, don't hardcode "Sign".

## Sending a real transaction

The same `confirmTransaction` call approves a real STX transfer, no special case needed — but two things a real transfer needs that a plain signed message doesn't:

```ts
import { request } from '@stacks/connect';
import { leatherDriver } from '@wallets-e2e/leather';

// 1. Point Leather at the same network your dapp's transaction targets. Leather defaults to
//    mainnet regardless of what your request names — a transfer from an account with no mainnet
//    balance crashes Leather's own fee-estimation step outright, not gracefully. This project
//    tried a local Clarinet devnet first and dropped it (two real, unrelated Clarinet 3.23.1
//    bugs made it unusable); real testnet is used instead.
await leatherDriver.switchToTestnetNetwork?.(context);

await leatherDriver.confirmTransaction(context, async () => {
  await page.getByRole('button', { name: 'Send STX' }).click(); // your dapp's own trigger
});
```

```ts
// 2. Your dapp's own request() call:
await request('stx_transferStx', {
  recipient: 'ST...',
  amount: 1_000_000, // micro-STX
  memo: 'short memo', // Stacks memo is a FIXED 34-byte buffer -- anything longer makes Leather's
  // fee-estimation step throw before any UI even renders ("Error generating unsigned stacks
  // transaction"). This is the one bug in this exact flow this project actually hit — it looked
  // exactly like an external wallet bug until the real cause (a 41-character memo) was found by
  // checking the request payload, not by assuming.
});
```

Confirm it actually landed on-chain — never trust "the popup closed" as proof:

```ts
import { waitForTransactionMined, TESTNET_RPC_URL } from '@wallets-e2e/core';

const status = await waitForTransactionMined(txid, { rpcUrl: TESTNET_RPC_URL, timeoutMs: 15 * 60 * 1000 });
// real testnet block times run ~10 minutes -- size your timeout accordingly, that's not a bug
```

Keep the transfer trigger and txid extraction in your dapp test; the wallet package owns only the
popup interaction and the core package owns receipt polling.

## Calling a real smart contract

Most dapps interact with contracts, not plain STX transfers — the same pattern applies via `stx_callContract`:

```ts
await request('stx_callContract', {
  contract: 'ST....counter', // deployer address + contract name
  functionName: 'increment',
  functionArgs: [], // ClarityValue[] -- @stacks/transactions' uintCV/standardPrincipalCV/etc. build these
});
```

Deploy your own test contract through the deployment tool already used by your dapp. The wallet
package does not ship or assume a counter contract; `confirmTransaction` works with any standard
contract call the dapp submits.

## Setup

```bash
npm install --save-dev @wallets-e2e/core@0.1.3 @wallets-e2e/leather@0.1.3 @playwright/test
npx playwright install chromium
```

The JavaScript APIs now come entirely from npm. Chromium still needs the real unpacked Leather
extension. Download a reviewed upstream commit archive, build it into your application's gitignored
extension directory, and point `extensionPath` there:

```bash
LEATHER_COMMIT=replace-with-reviewed-commit
mkdir -p .wallet-extensions
curl --fail --location \
  "https://github.com/leather-io/extension/archive/${LEATHER_COMMIT}.zip" \
  --output .wallet-extensions/leather.zip
unzip -q .wallet-extensions/leather.zip -d .wallet-extensions/leather-source
cd ".wallet-extensions/leather-source/extension-${LEATHER_COMMIT}"
pnpm install
pnpm prepare
pnpm build
cd -
mkdir -p .wallet-extensions/leather
cp -R ".wallet-extensions/leather-source/extension-${LEATHER_COMMIT}/dist" \
  .wallet-extensions/leather/dist
```

Set `LEATHER_EXTENSION_PATH=.wallet-extensions/leather/dist`, or rely on that default in the example.
Building a moving upstream branch is not deterministic, so record the reviewed commit in your
application's dependency policy. Fund the dedicated fixture address from a Stacks testnet faucet
before opted-in transfer or contract tests; never make faucet funding part of the test itself.

## The one thing to get right in your own dapp: picking the Stacks address

`@stacks/connect`'s `getAddresses` result (what `connect()` resolves to) returns **multiple** addresses — typically two Bitcoin formats plus one Stacks address, in no guaranteed order. This project's own example app got this wrong at first: `response.addresses[0]` silently picked a Bitcoin address, and only a real test run (not a code review) caught it. Always filter explicitly:

```ts
const stxAddress = response.addresses.find((a) => a.symbol === 'STX')?.address ?? null;
```

Also: `@stacks/connect`'s exported `signMessage()` function is **deprecated and a no-op** — it does nothing at all. Use the generic RPC call instead: `request('stx_signMessage', { message })`, which resolves to `{ signature, publicKey }`.

## Write your own fixture wallet

Never import a real seed phrase for testing. Generate a fresh one, derive its address independently so you can assert against a value you actually trust (don't just echo back whatever the UI happens to report), and check the phrase in the clear so anyone reviewing your tests can audit exactly what it is:

```bash
# One way to derive the address a seed phrase resolves to, independent of the wallet UI:
npm install @stacks/wallet-sdk @stacks/transactions
node -e "
const { generateWallet } = require('@stacks/wallet-sdk');
const { getAddressFromPrivateKey } = require('@stacks/transactions');
(async () => {
  const wallet = await generateWallet({ secretKey: 'YOUR TWENTY FOUR WORD PHRASE HERE', password: 'unused' });
  console.log(getAddressFromPrivateKey(wallet.accounts[0].stxPrivateKey, 'mainnet'));
})();
"
```

The public `@wallets-e2e/leather/fixtures/wallet.js` export reads
`WALLETS_E2E_SEED_PHRASE`, `WALLETS_E2E_MAINNET_ADDRESS`,
`WALLETS_E2E_TESTNET_ADDRESS`, and `WALLETS_E2E_PASSWORD` from the environment. The mainnet-form
address is required even when the test later switches to testnet4 because Leather's persisted
unlocked state uses that form. Use a strong local extension password; a weak password leaves
Leather's onboarding button disabled.

## What's not here yet

- **Xverse support** — Leather only, for now.
- **Local devnet** — tried and dropped (see [Sending a real transaction](#sending-a-real-transaction) above). Every test that touches chain state here runs against real testnet.

Contributions on any of these are very welcome — see `CONTRIBUTING.md`.

## Continue with the package tutorials

- [`feature-files.md`](./feature-files.md) — consume `@wallets-e2e/core/bdd` with playwright-bdd.
- [`reports-and-artifacts.md`](./reports-and-artifacts.md) — consume the package reporting and
  extension fixture APIs.
- [`@wallets-e2e/leather` on npm](https://www.npmjs.com/package/@wallets-e2e/leather) — published
  package metadata and version history.
