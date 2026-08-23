# playwright-stacks-wallet

Playwright commands and fixtures for driving **real** Stacks wallet browser extensions in end-to-end tests — real unlock, real connection approval, real transaction signature. No mocking.

**Leather is supported today. More wallets are coming — contributions welcome, see [Contributing](#contributing).**

## Status

Early / pre-alpha, but the core mechanism is proven: launching a real, source-built Leather extension in a Playwright-controlled browser, unlocking it, approving a real dapp connection, and signing a real message all work end to end today (video-recorded, no mocks) — see `examples/spike` and `examples/react-connect` for the real, passing test suites.

## Prerequisites

- **Node.js** — a recent LTS release (this project was verified against Node 24).
- **pnpm** — this repo is a pnpm workspace (`packageManager` pins `pnpm@9.11.0` in `package.json`; a compatible pnpm on your machine is fine).
- **git** — the Leather extension is cloned from source as part of the build step below.
- A machine that can run a real (headed) Chromium browser. Headless is technically possible with Playwright's bundled Chromium but this project doesn't rely on it yet.

> **Want to test your own dapp against a real Leather wallet?** [`tutorials/quick-start.md`](./tutorials/quick-start.md) walks through it — what works today, what's coming, and a real working example. This README is about developing *this* project, not using it in yours.

## Quick start

```bash
git clone <this-repo-url>
cd playwright-stacks-wallet

# 1. Install workspace dependencies
pnpm install

# 2. Build the real Leather extension from source (clones leather-io/extension,
#    installs its deps, builds it — this step is slow the first time, fast after
#    because it's idempotent: it skips the rebuild if wallets/leather/dist already
#    has a manifest.json)
pnpm build:leather

# 3. Type-check every package
pnpm build

# 4. Run the tests — this actually launches a real Chromium window, loads the
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
3. A **24-word** test-only seed phrase (see [Fixture wallet](#fixture-wallet-safety) below) is typed into Leather's 24 individual word fields — Leather defaults to a 24-word layout, and the fixture seed is deliberately 24 words to match.
4. Leather asks for a password to encrypt the key on this device. A password meeting Leather's minimum strength bar is filled in (a weak password like `password1` leaves Leather's own "Continue" button disabled — this is Leather's behavior, not a bug in this project).
5. Leather unlocks into its normal dashboard (`Account 1`, balances, Send/Receive/Buy/Swap).
6. The test reads the unlocked account's address back out of the extension's own persisted storage (not scraped from on-screen text — Leather's dashboard doesn't render the address as plain text) and checks it matches what the fixture seed phrase is independently known to derive to.
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
4. Leather's icon appears in your toolbar — click it to open the same onboarding flow the test automates (Create new wallet / Use existing key / Use Ledger).
5. If you want to unlock it with the exact test fixture wallet (so you're looking at the same account the automated test uses), the seed phrase and password are in `wallets/leather/fixtures/devnet-wallet.ts` — read the comments there first, they explain why those exact values are safe to use and why they must never be swapped for anything real.

**Do not import a real, value-holding seed phrase into a build you're using for manual testing.** Keep manual testing and real funds completely separate.

## Watching the recorded video

Every test run produces one or more `.webm` files under `examples/spike/test-results/videos/`, regardless of pass or fail. Open the most recent one in any video player (or drag it into a browser tab) to watch exactly what the automated browser did.

## Fixture wallet (safety)

`wallets/leather/fixtures/devnet-wallet.ts` holds a seed phrase generated specifically for this project. It has never held, and will never hold, anything of real value — it exists purely so tests are repeatable. It's checked into the repository in the clear on purpose (so anyone can audit exactly what it is), and it's never sourced from an environment variable. If you're extending this project: **never replace it with a real-value seed, and never point any part of this project at mainnet or a real funded account.**

## Project layout

```
playwright-stacks-wallet/
  packages/
    core/       # Shared machinery: launches the browser context, resolves the
                # extension's ID, defines the WalletDriver interface every
                # wallet adapter implements.
  wallets/
    leather/       # The Leather adapter — the only one implemented today.
  examples/
    spike/          # Unlock-only tests, driven directly against Leather's own UI.
    react-connect/  # A minimal real React dapp (Connect + Sign Message) with its own
                    # passing tests — the target connectToDapp/confirmTransaction prove
                    # themselves against.
```

Adding a new wallet means adding a new package under `wallets/` that implements the same `WalletDriver` interface `packages/core` exports — see [Contributing](#contributing).

## Contributing

Contributions are very welcome, especially:

- **New wallet adapters** (Xverse and others) — the `WalletDriver` interface in `packages/core` is the contract to implement; `wallets/leather` is the reference example.
- **Filling in the rest of the driver** — today only unlocking a wallet is implemented; approving a dApp connection and approving a transaction signature are still open.
- **Bug reports** — especially "this broke because the real extension's UI changed" reports, since this project drives real, unmocked UI that can and will change upstream.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full guide (dev setup, how the driver pattern works, PR expectations).

## License

MIT — see [`LICENSE`](./LICENSE).
