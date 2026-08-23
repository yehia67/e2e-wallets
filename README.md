# wallets-e2e

Playwright commands and fixtures for driving **real** Stacks wallet browser extensions in end-to-end tests  real unlock, real connection approval, real transaction signature. No mocking.

**Leather is supported today. More wallets are coming  contributions welcome, see [Contributing](#contributing).**

<p align="center">
  <img src="./docs/demo-full-flow.gif" alt="Playwright driving the real Leather extension end to end: unlocking with a 24-word seed, switching to testnet, approving a signed message, a real STX transfer, and a real smart-contract call" width="560">
  <br>
  <em>Real footage, stitched from this repo's own test suite: unlock → network switch → sign → transfer → contract call, every popup real, every txid real.</em>
</p>

## Status

Early / pre-alpha, but the core mechanism is proven: launching a real, source-built Leather extension in a Playwright-controlled browser, unlocking it, approving a real dapp connection, signing a real message, sending a real signed STX transfer, and calling a real deployed smart contract all work end to end today (video-recorded, no mocks)  confirmed on real Stacks testnet, not a mock chain. See `examples/spike` and `examples/react-connect` for the real, passing test suites.

A local Clarinet devnet was tried first and dropped: two independent, real Clarinet 3.23.1 bugs (a permanent chain stall a few minutes after every boot, and contract deploys that can't land before that stall) made it unusable. Real testnet is used instead.

## Prerequisites

- **Node.js**  a recent LTS release (this project was verified against Node 24).
- **pnpm**  this repo is a pnpm workspace (`packageManager` pins `pnpm@9.11.0` in `package.json`; a compatible pnpm on your machine is fine).
- **git**  the Leather extension is cloned from source as part of the build step below.
- A machine that can run a real (headed) Chromium browser. Headless is technically possible with Playwright's bundled Chromium but this project doesn't rely on it yet.

> **Want to test your own dapp against a real Leather wallet?** [`tutorials/quick-start.md`](./tutorials/quick-start.md) walks through it  what works today, what's coming, and a real working example. This README is about developing *this* project, not using it in yours.

## Quick start

```bash
git clone <this-repo-url>
cd wallets-e2e

# 1. Install workspace dependencies
pnpm install

# 2. Build the real Leather extension from source (clones leather-io/extension,
#    installs its deps, builds it  this step is slow the first time, fast after
#    because it's idempotent: it skips the rebuild if wallets/leather/dist already
#    has a manifest.json)
pnpm build:leather

# 3. Type-check every package
pnpm build

# 4. Run the tests  this actually launches a real Chromium window, loads the
#    real extension, and drives it. Expect a browser window to pop up.
pnpm test
```

A passing run looks like:

```
Running 3 tests using 1 worker

  ✓  Story 1.1: loads and unlocks the real Leather extension, video-recorded (~5s)
  ✓  I/O matrix: missing extension build fails fast with a clear error, never silently skips
  ✓  I/O matrix: malformed fixture seed fails loudly instead of reporting a soft "unlocked: false"

  3 passed
```

## What just happened, step by step

If you want to understand (or manually reproduce) exactly what the test automated:

1. A fresh, temporary browser profile is created and Chromium launches with the real Leather extension loaded unpacked (`--load-extension`).
2. The extension's own onboarding screen opens. The test clicks **"Use existing key."**
3. A **24-word** test-only seed phrase (see [Fixture wallet and bringing your own account](#fixture-wallet-and-bringing-your-own-account) below) is typed into Leather's 24 individual word fields  Leather defaults to a 24-word layout, and the fixture seed is deliberately 24 words to match.
4. Leather asks for a password to encrypt the key on this device. A password meeting Leather's minimum strength bar is filled in (a weak password like `password1` leaves Leather's own "Continue" button disabled  this is Leather's behavior, not a bug in this project).
5. Leather unlocks into its normal dashboard (`Account 1`, balances, Send/Receive/Buy/Swap).
6. The test reads the unlocked account's address back out of the extension's own persisted storage (not scraped from on-screen text  Leather's dashboard doesn't render the address as plain text) and checks it matches what the fixture seed phrase is independently known to derive to.
7. The whole run is video-recorded to `examples/spike/test-results/videos/*.webm`, whether it passes or fails.

## Reproducing this by hand (manual testing)

Want to watch it happen yourself, or poke at the real extension UI directly, outside of the automated test?

```bash
# Build the extension first if you haven't (idempotent, see Quick start step 2)
pnpm build:leather
```

Then load it like a normal Chrome user would:

1. Open Chrome (or Chromium) and go to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select `wallets/leather/dist`.
4. Leather's icon appears in your toolbar  click it to open the same onboarding flow the test automates (Create new wallet / Use existing key / Use Ledger).
5. If you want to unlock it with the exact test fixture wallet (so you're looking at the same account the automated test uses), the seed phrase and password are in `wallets/leather/fixtures/wallet.ts`  read the comments there first, they explain why those exact values are safe to use and why they must never be swapped for anything real.

**Do not import a real, value-holding seed phrase into a build you're using for manual testing.** Keep manual testing and real funds completely separate.

## Watching the recorded video

Every test run produces one or more `.webm` files under `examples/spike/test-results/videos/`, regardless of pass or fail. Open the most recent one in any video player (or drag it into a browser tab) to watch exactly what the automated browser did.

## Quick example

The smallest real thing you can do with this project  launch the real extension, unlock it, and approve a connection request from a dapp:

```ts
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

test('connects to my dapp', async () => {
  const context = await launchContext({
    extensionPath: 'wallets/leather/dist',
    userDataDir: '.tmp/my-test-profile',
    recordVideoDir: 'test-results/videos',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your dapp, running locally

  await leatherDriver.importWallet(context, wallet.seedPhrase);

  await leatherDriver.connectToDapp(context, async () => {
    await page.getByRole('button', { name: 'Connect Wallet' }).click(); // your dapp's own button
    await selectWalletInStacksConnectModal(page, 'Leather');
  });

  await expect(page.getByText(wallet.testnetAddress)).toBeVisible();
  await context.close();
});
```

See [`tutorials/quick-start.md`](./tutorials/quick-start.md) for signing, transferring, and calling a contract on top of this.

## Fixture wallet and bringing your own account

`wallets/leather/fixtures/wallet.ts` exports one `wallet` object. Every field on it reads from an environment variable first, falling back to a safe, checked-in, no-value default  no account is hardcoded as the *only* option:

```bash
WALLETS_E2E_SEED_PHRASE="your twenty four word secret key" \
WALLETS_E2E_MAINNET_ADDRESS="SP..." \
WALLETS_E2E_TESTNET_ADDRESS="ST..." \
pnpm test
```

Both addresses are required if you override the seed  `importWallet`'s real verification step checks the unlocked account's address against `mainnetAddress`, so it fails loudly on a mismatch rather than silently trusting an unverified account.

The checked-in default has never held, and will never hold, anything of real value  it exists purely so `pnpm test` works out of the box with no setup. If you're extending this project: **never replace the default with a real-value seed in source, and never point any part of this project at mainnet or a real funded account**  use the environment variables above instead.

## Project layout

```
wallets-e2e/
  packages/
    core/       # Shared machinery: launches the browser context, resolves the
                # extension's ID, defines the WalletDriver interface every
                # wallet adapter implements, RPC-confirms transactions on chain.
  wallets/
    leather/       # The Leather adapter  the only one implemented today.
  contracts/
    counter.clar    # A minimal example contract deployed to testnet (see scripts/).
  scripts/
    deploy-counter-testnet.mjs  # One-time: deploys contracts/counter.clar to real testnet.
  examples/
    spike/          # Unlock-only tests, driven directly against Leather's own UI.
    react-connect/  # A minimal real React dapp (Connect, Sign Message, Send STX, Call
                    # Contract) with its own passing tests  the target connectToDapp/
                    # confirmTransaction prove themselves against.
```

Adding a new wallet means adding a new package under `wallets/` that implements the same `WalletDriver` interface `packages/core` exports  see [Contributing](#contributing).

## Contributing

Contributions are very welcome, especially:

- **New wallet adapters** (Xverse and others)  the `WalletDriver` interface in `packages/core` is the contract to implement; `wallets/leather` is the reference example.
- **Bug reports**  especially "this broke because the real extension's UI changed" reports, since this project drives real, unmocked UI that can and will change upstream.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full guide (dev setup, how the driver pattern works, PR expectations).

## License

MIT  see [`LICENSE`](./LICENSE).
