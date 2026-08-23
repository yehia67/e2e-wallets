# Quick Start: testing your Stacks dapp against a real Leather wallet

`wallets-e2e` lets you drive a **real** Leather browser extension from a Playwright test against your own dapp — real unlock, real connection-approval, real transaction-signing, no mocked wallet object standing in for the real thing. Nothing like this existed for Stacks wallets before.

**Honest status up front:** unlocking a wallet, connecting to a dapp, signing a message, sending a real signed STX transfer, and calling a real deployed smart contract all work today, end to end, against the real extension — confirmed on real Stacks testnet. Xverse support isn't implemented yet — see [What's not here yet](#whats-not-here-yet) below.

## A real, working example

```ts
import { test, expect } from '@playwright/test';
import { launchContext, resolveExtensionId, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

test('user connects and signs a message', async () => {
  const context = await launchContext({ extensionPath: LEATHER_DIST, userDataDir, recordVideoDir });
  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your dapp, running locally

  await leatherDriver.importWallet(context, wallet.seedPhrase);

  // `trigger` is every dapp-side click needed to reach the real popup — yours to write, since
  // only you know your dapp's buttons. `@stacks/connect`'s own wallet-picker modal (not any
  // wallet's own UI) is handled by the shared `selectWalletInStacksConnectModal` helper.
  await leatherDriver.connectToDapp(context, async () => {
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await selectWalletInStacksConnectModal(page, 'Leather');
  });

  await leatherDriver.confirmTransaction(context, async () => {
    await page.getByRole('button', { name: 'Sign Message' }).click();
  });

  await expect(page.getByText(/signature/i)).toBeVisible();
});
```

Not hypothetical — this is (lightly trimmed) the actual test in `examples/react-connect/tests/`, running against a real minimal dapp in this repo, against the real Leather extension, today. Both `examples/spike` (unlock only) and `examples/react-connect` (unlock + connect + sign) have real, passing test suites — go read them for the full, current reference rather than trusting this tutorial to stay perfectly in sync.

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

The `trigger` callback is the only thing that changes per call — it's just "whatever your dapp does to open the next popup." `confirmTransaction` itself doesn't care what kind of approval it is, only that a real Leather popup opens, gets approved, and closes cleanly (see `examples/react-connect/tests/sign.spec.ts`'s bad-trigger test for what happens when that doesn't happen: it throws, in seconds, rather than hanging).

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

See `examples/react-connect/tests/transfer.spec.ts` for the full, real, passing test.

## Calling a real smart contract

Most dapps interact with contracts, not plain STX transfers — the same pattern applies via `stx_callContract`:

```ts
await request('stx_callContract', {
  contract: 'ST....counter', // deployer address + contract name
  functionName: 'increment',
  functionArgs: [], // ClarityValue[] -- @stacks/transactions' uintCV/standardPrincipalCV/etc. build these
});
```

`scripts/deploy-counter-testnet.mjs` in this repo deploys a minimal example contract to real testnet from the fixture wallet; `examples/react-connect/tests/contract-call.spec.ts` is the full, real, passing test — same `confirmTransaction` call, same RPC-confirmation pattern as a transfer.

## Setup

```bash
git clone https://github.com/yehia67/e2e-wallets.git
cd e2e-wallets
pnpm install
pnpm build:leather   # builds the real Leather extension from source (idempotent)
pnpm build
pnpm test            # runs every real test across every example package
```

The transfer and contract-call tests need the fixture wallet funded with real (faucet, no-value) testnet STX first — rate-limited, so it's a separate manual step, not run automatically:

```bash
node examples/react-connect/scripts/fund-fixture-wallet-testnet.mjs
node scripts/deploy-counter-testnet.mjs   # one-time: deploys the example contract the contract-call test calls
```

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/leather
```

[`@wallets-e2e/core`](https://www.npmjs.com/package/@wallets-e2e/core) is published. [`@wallets-e2e/leather`](https://www.npmjs.com/package/@wallets-e2e/leather) is on its way — if it's not live yet, `git clone` this repo and reference `packages/core` / `wallets/leather` via a workspace or `file:` path instead, the way `examples/react-connect` does (`"@wallets-e2e/core": "workspace:*"`).

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

`wallets/leather/fixtures/wallet.ts` in this repo shows the real pattern, including why the address it asserts against is the *mainnet*-form one — Leather's own persisted state surfaces that form, not the devnet/testnet one, which only became clear by actually inspecting a real unlocked wallet's storage rather than assuming. It also documents a real, separate gotcha: Leather enforces a minimum password-strength meter during setup — a weak password leaves its own "Continue" button permanently disabled.

Prefer not writing even a throwaway seed into your own source at all? `wallet.ts` reads `WALLETS_E2E_SEED_PHRASE`/`WALLETS_E2E_MAINNET_ADDRESS`/`WALLETS_E2E_TESTNET_ADDRESS` from the environment before falling back to its checked-in default — the same pattern works for your own fixture wallet, keeping the actual phrase out of your repo entirely.

## What's not here yet

- **Xverse support** — Leather only, for now.
- **Published npm package** — clone-and-workspace-link only, see Setup above.
- **Local devnet** — tried and dropped (see [Sending a real transaction](#sending-a-real-transaction) above). Every test that touches chain state here runs against real testnet.

Contributions on any of these are very welcome — see `CONTRIBUTING.md`.

## The `examples/` folder

Everything in this tutorial is trimmed from real code — the full, currently-passing reference lives in `examples/`:

- **`examples/spike/`** — the minimal proving case: load Leather, unlock it, nothing else. Start here if you just want to confirm the extension loads correctly in your environment.
- **`examples/react-connect/`** — a real, running React dapp (`pnpm --filter @wallets-e2e/example-react-connect dev`) with Connect Wallet, Sign Message, Send STX, and Call Contract buttons, plus `tests/connect.spec.ts`, `tests/sign.spec.ts`, `tests/transfer.spec.ts`, and `tests/contract-call.spec.ts` — the fullest working reference for wiring `connectToDapp` and `confirmTransaction` into an app of your own.

Run `pnpm test` from the repo root to execute every example's test suite in one go.
