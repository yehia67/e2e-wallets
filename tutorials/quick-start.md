# Quick Start: testing your Stacks dapp against a real Leather wallet

`playwright-stacks-wallet` lets you drive a **real** Leather browser extension from a Playwright test against your own dapp — real unlock, and soon real connection-approval and real transaction-signing, no mocked wallet object standing in for the real thing. Nothing like this existed for Stacks wallets before.

**Honest status up front:** unlocking a wallet works today, end to end, against the real extension. Connecting to a dapp and signing a transaction are designed (the interface exists) but not implemented yet — see [What's not here yet](#whats-not-here-yet) below. This tutorial shows you exactly what you can rely on right now.

## What you'll be able to test, once this reaches your dapp

Picture a staking dapp with three buttons — *Connect Wallet*, *Approve*, *Stake* — the same shape as any typical Web3 frontend. The eventual goal is a test file for that dapp that looks roughly like this:

```ts
import { test, expect } from '@playwright/test';
import { launchContext } from '@stacks-wallet/core';
import { leatherDriver } from '@stacks-wallet/leather';
import { devnetWallet } from './fixtures/my-test-wallet';

test('user connects, approves, and stakes', async () => {
  const context = await launchContext({ extensionPath: LEATHER_DIST, userDataDir, recordVideoDir });
  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your dapp, running locally

  await leatherDriver.importWallet(context, devnetWallet.seedPhrase);

  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await leatherDriver.connectToDapp(context, async () => {}); // approves in the real popup

  await page.getByRole('button', { name: 'Approve' }).click();
  await leatherDriver.confirmTransaction(context, async () => {});

  await page.getByRole('button', { name: 'Stake' }).click();
  await leatherDriver.confirmTransaction(context, async () => {});

  await expect(page.getByText('Staked successfully')).toBeVisible();
});
```

That's the destination — a normal-looking Playwright test where your dapp's own buttons drive a real wallet popup, no mocking. The two `confirmTransaction`/`connectToDapp` calls in that example are not real yet (see below); everything else is.

## What actually works today

The one thing you can rely on right now: launching a real, source-built Leather extension in a Playwright context and unlocking it with a wallet you control. That's useful on its own — it's the foundation every dapp-connection test will sit on top of, and it already proves the hard part (driving a real extension popup with Playwright) works.

```bash
git clone <this-repo-url>
cd playwright-stacks-wallet
pnpm install
pnpm build:leather   # builds the real Leather extension from source (idempotent)
pnpm build
```

A minimal test using this project's real, working API:

```ts
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchContext, resolveExtensionId } from '@stacks-wallet/core';
import { leatherDriver } from '@stacks-wallet/leather';

const LEATHER_DIST = join(__dirname, 'node_modules/@stacks-wallet/leather/dist');

test('unlocks a real Leather wallet', async () => {
  const context = await launchContext({
    extensionPath: LEATHER_DIST,
    userDataDir: mkdtempSync(join(tmpdir(), 'my-dapp-tests-')),
    recordVideoDir: join(__dirname, 'test-results/videos'),
  });

  const extensionId = await resolveExtensionId(context);
  expect(extensionId).toBeTruthy();

  // Use your OWN devnet-only fixture wallet here — never a real one. See "Write your own
  // fixture wallet" below for how this project's own fixture was generated and verified.
  const account = await leatherDriver.importWallet(context, MY_DEVNET_SEED_PHRASE);
  expect(account.address).toBe(MY_EXPECTED_MAINNET_ADDRESS);

  await context.close();
});
```

This is not hypothetical — it's the same pattern `examples/spike/tests/1-1-load-and-unlock.spec.ts` in this repo runs for real, today, against the real extension (video-recorded, 3 passing tests including two real failure-mode checks). Go read that file for the actual, currently-working reference.

**Not published to npm yet.** Until it is, use it as a local dependency — `git clone` this repo and reference `packages/core` / `wallets/leather` via a `file:` or workspace path, the same way this repo's own `examples/spike` package does (`"@stacks-wallet/core": "workspace:*"`).

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

`wallets/leather/fixtures/devnet-wallet.ts` in this repo shows the real pattern, including why the address it asserts against is the *mainnet*-form one — Leather's own persisted state surfaces that form, not the devnet/testnet one, which only became clear by actually inspecting a real unlocked wallet's storage rather than assuming.

## What's not here yet

- **`connectToDapp`** — approving a dapp's connection request in the real popup. The interface exists (`packages/core`'s `WalletDriver`); the implementation throws `not implemented`.
- **`confirmTransaction`** — approving a signature/transaction request. Same status.
- **An example dapp page** to test against — this repo currently drives Leather's own onboarding screens directly, not a third-party page. Testing *your* dapp means pointing `page.goto()` at wherever your dapp runs locally, the way the illustrative example above does — that part already works, it's the wallet-side `connectToDapp`/`confirmTransaction` calls that don't yet.
- **Xverse support** — Leather only, for now.

If you need connection/signing testing today, you'll need to implement those two `WalletDriver` methods yourself against your fork — `wallets/leather/src/index.ts`'s `importWallet` is a real, working reference for the pattern (inspect the real popup UI first, never guess selectors; verify success against a real signal, never trust "the click didn't error"). Contributions finishing this are very welcome — see `CONTRIBUTING.md`.
