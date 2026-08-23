# wallets-e2e

Playwright fixtures for driving **real** Stacks wallet browser extensions in end-to-end tests — real unlock, real connection approval, real transaction signature. No mocking.

**Leather is supported today. More wallets are coming — contributions welcome, see [Contributing](#contributing).**

<p align="center">
  <img src="./docs/demo-full-flow.gif" alt="Playwright driving the real Leather extension end to end: unlocking with a 24-word seed, switching to testnet, approving a signed message, a real STX transfer, and a real smart-contract call" width="560">
  <br>
  <em>Real footage, stitched from this repo's own test suite: unlock → network switch → sign → transfer → contract call, every popup real, every txid real.</em>
</p>

## Install

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/leather @playwright/test
```

Then build the real extension from source once (idempotent — skips if already built):

```bash
git clone --depth 1 https://github.com/leather-io/extension.git /tmp/leather-source
cd /tmp/leather-source && pnpm install && pnpm prepare && pnpm build
cp -R dist /path/to/your/project/wallets/leather/dist
```

## Quick start

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

See [`tutorials/quick-start.md`](./tutorials/quick-start.md) for signing, transferring, and calling a contract on top of this — plus every real gotcha this project's own test suite has hit.

## Status

Early / pre-alpha, but the core mechanism is proven: unlocking a real, source-built Leather extension, approving a real dapp connection, signing a real message, sending a real signed STX transfer, and calling a real deployed smart contract all work end to end today (video-recorded, no mocks) — confirmed on real Stacks testnet. See `examples/spike` and `examples/react-connect` for the real, passing test suites.

## Fixture wallet and bringing your own account

`wallets/leather/fixtures/wallet.ts` exports one `wallet` object. Every field reads from an environment variable first, falling back to a safe, checked-in, no-value default — no account is hardcoded as the *only* option:

```bash
WALLETS_E2E_SEED_PHRASE="your twenty four word secret key" \
WALLETS_E2E_MAINNET_ADDRESS="SP..." \
WALLETS_E2E_TESTNET_ADDRESS="ST..." \
pnpm test
```

Both addresses are required if you override the seed — `importWallet`'s real verification step checks the unlocked account's address against `mainnetAddress`, so it fails loudly on a mismatch rather than trusting an unverified account. The checked-in default has never held, and will never hold, anything of real value. **Never replace it with a real-value seed in source, and never point any part of this project at mainnet or a real funded account** — use the environment variables above instead.

## Using this with an AI coding agent

[`claude-skill/wallets-e2e/`](./claude-skill/wallets-e2e/) is a [Claude Code](https://claude.com/claude-code) Skill teaching an agent how to use this package correctly — the real API surface, a working example, and every real gotcha this project's own test suite has hit. Copy it into any project that depends on `@wallets-e2e/core`/`@wallets-e2e/leather`:

```bash
cp -R /path/to/wallets-e2e/claude-skill/wallets-e2e /path/to/your/project/.claude/skills/wallets-e2e
```

An MCP server is a planned, separate follow-up — not built yet.

## Contributing

Contributions are very welcome, especially new wallet adapters (Xverse and others — the `WalletDriver` interface in `packages/core` is the contract to implement, `wallets/leather` is the reference example) and bug reports when the real extension's UI changes upstream. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev setup and PR expectations.

## License

MIT — see [`LICENSE`](./LICENSE).
