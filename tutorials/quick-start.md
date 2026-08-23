# Quick Start: testing your Stacks dapp against a real Leather wallet

`playwright-stacks-wallet` lets you drive a **real** Leather browser extension from a Playwright test against your own dapp — real unlock, real connection-approval, real transaction-signing, no mocked wallet object standing in for the real thing. Nothing like this existed for Stacks wallets before.

**Honest status up front:** unlocking a wallet, connecting to a dapp, and signing a message all work today, end to end, against the real extension. Broadcasting a real on-chain transaction and Xverse support are not implemented yet — see [What's not here yet](#whats-not-here-yet) below.

## A real, working example

```ts
import { test, expect } from '@playwright/test';
import { launchContext, resolveExtensionId, selectWalletInStacksConnectModal } from '@stacks-wallet/core';
import { leatherDriver } from '@stacks-wallet/leather';
import { devnetWallet } from '@stacks-wallet/leather/fixtures/devnet-wallet.js';

test('user connects and signs a message', async () => {
  const context = await launchContext({ extensionPath: LEATHER_DIST, userDataDir, recordVideoDir });
  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your dapp, running locally

  await leatherDriver.importWallet(context, devnetWallet.seedPhrase);

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

## Setup

```bash
git clone <this-repo-url>
cd playwright-stacks-wallet
pnpm install
pnpm build:leather   # builds the real Leather extension from source (idempotent)
pnpm build
pnpm test            # runs every real test across every example package
```

**Not published to npm yet** (see [Story 1.5](../_bmad-output/planning-artifacts/epics.md) if you're curious about the plan). Until it is, use this as a local dependency — `git clone` this repo and reference `packages/core` / `wallets/leather` via a workspace or `file:` path, the way `examples/react-connect` does (`"@stacks-wallet/core": "workspace:*"`).

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

`wallets/leather/fixtures/devnet-wallet.ts` in this repo shows the real pattern, including why the address it asserts against is the *mainnet*-form one — Leather's own persisted state surfaces that form, not the devnet/testnet one, which only became clear by actually inspecting a real unlocked wallet's storage rather than assuming. It also documents a real, separate gotcha: Leather enforces a minimum password-strength meter during setup — a weak password leaves its own "Continue" button permanently disabled.

## What's not here yet

- **Broadcasting and confirming a real on-chain transaction** (vs. signing a plain message) — the popup-approval mechanism (`confirmTransaction`) is proven and identical either way, but no test here submits an actual devnet transaction yet.
- **Xverse support** — Leather only, for now.
- **Published npm package** — clone-and-workspace-link only, see Setup above.

Contributions on any of these are very welcome — see `CONTRIBUTING.md`.
