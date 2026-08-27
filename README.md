# wallets-e2e

Playwright fixtures for driving **real** Stacks wallet browser extensions in end-to-end tests — real unlock, real connection approval, real transaction signature. No mocking.

[![@wallets-e2e/core](https://img.shields.io/npm/v/@wallets-e2e/core?label=%40wallets-e2e%2Fcore)](https://www.npmjs.com/package/@wallets-e2e/core)
[![@wallets-e2e/leather](https://img.shields.io/npm/v/@wallets-e2e/leather?label=%40wallets-e2e%2Fleather)](https://www.npmjs.com/package/@wallets-e2e/leather)
[![license](https://img.shields.io/npm/l/@wallets-e2e/core)](./LICENSE)

Leather is supported today. More wallets are coming — [contributions welcome](./CONTRIBUTING.md).

<p align="center">
  <img src="./docs/demo-full-flow.gif" alt="Playwright driving the real Leather extension end to end: unlocking with a 24-word seed, switching to testnet, approving a signed message, a real STX transfer, and a real smart-contract call" width="560">
  <br>
  <em>Real footage from this repo's own test suite: unlock → network switch → sign → transfer → contract call. Every popup real, every txid real.</em>
</p>

## Install

```bash
pnpm add -D @wallets-e2e/core @wallets-e2e/leather @playwright/test
```

## Use it

```ts
// tests/connect.spec.ts
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

test('connects to my dapp', async () => {
  const context = await launchContext({
    extensionPath: 'wallets/leather/dist',
    userDataDir: '.tmp/my-test-profile',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your dapp

  await leatherDriver.importWallet(context, wallet.seedPhrase);

  await leatherDriver.connectToDapp(context, async () => {
    await page.getByRole('button', { name: 'Connect Wallet' }).click(); // your button
    await selectWalletInStacksConnectModal(page, 'Leather');
  });

  await expect(page.getByText(wallet.testnetAddress)).toBeVisible();
  await context.close();
});
```

```ts
// playwright.config.ts — workers: 1 is required, Leather's profile can't be shared
import { defineConfig } from '@playwright/test';

export default defineConfig({ workers: 1, fullyParallel: false });
```

```bash
npx playwright test
```

→ **[Full walkthrough](./tutorials/quick-start.md)** — signing, STX transfers, contract calls, and every gotcha this project's own suite has hit.

### `extensionPath`

Leather ships no build to npm, so build it once:

```bash
git clone --depth 1 https://github.com/leather-io/extension.git /tmp/leather-source
cd /tmp/leather-source && pnpm install && pnpm prepare && pnpm build
cp -R /tmp/leather-source/dist ~/your-project/wallets/leather/dist
```

## Gherkin / `.feature` files

For reviewers who don't read Playwright TypeScript. `@wallets-e2e/core/bdd` ships the **wallet** steps; you write the steps about your own dapp.

```gherkin
@timeout:1_200_000
Scenario: A connected visitor sends 1 STX and it lands on chain
  Given I am connected to Stacks testnet
  When I request a transfer of 1 STX
  And I approve the wallet popup
  Then a transaction id is shown
  And the transaction is mined
```

No seed phrase, no network switch, no extension path, no popup mechanics — `Given I am connected to Stacks testnet` does all three, because that is what the sentence means.

```bash
pnpm add -D playwright-bdd
```

Optional peer dependency: only the `@wallets-e2e/core/bdd` subpath needs it.

> **The one rule:** your dapp steps must *queue* their click with `queueWalletTrigger`, never perform it. The driver starts listening for the popup before it runs your action; a step that clicks directly opens the popup with nobody listening. Most common way to misuse this package.

→ **[Full walkthrough](./tutorials/feature-files.md)** · working setup in [`examples/bdd/`](./examples/bdd/)

## Bring your own account

`wallet` reads every field from an environment variable, falling back to a checked-in, no-value default:

```bash
WALLETS_E2E_SEED_PHRASE="your twenty four word secret key" \
WALLETS_E2E_MAINNET_ADDRESS="SP..." \
WALLETS_E2E_TESTNET_ADDRESS="ST..." \
pnpm test
```

Both addresses are required if you override the seed — `importWallet` verifies the unlocked account against `mainnetAddress` and fails loudly on a mismatch.

Keep the seed in the environment, not in source — the checked-in default is a throwaway.

## Status

Pre-alpha, but the mechanism is proven end to end on real Stacks testnet — unlock, dapp connection, message signature, signed STX transfer, and a deployed contract call, all video-recorded with no mocks. See [`examples/`](./examples/) for the passing suites.

## Using this with an AI coding agent

[`claude-skill/wallets-e2e/`](./claude-skill/wallets-e2e/) is a [Claude Code](https://claude.com/claude-code) Skill teaching an agent the real API surface and gotchas. Copy it into your project:

```bash
cp -R claude-skill/wallets-e2e ~/your-project/.claude/skills/wallets-e2e
```

An MCP server is planned, not built yet.

## Contributing

New wallet adapters especially welcome — implement the `WalletDriver` interface in `packages/core`, using [`wallets/leather`](./wallets/leather/) as the reference. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](./LICENSE).
