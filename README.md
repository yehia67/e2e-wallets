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

Signing, transfers, contract calls: [`tutorials/quick-start.md`](./tutorials/quick-start.md). Gherkin `.feature` files: [`tutorials/feature-files.md`](./tutorials/feature-files.md).

### `extensionPath`

Leather ships no build to npm, so build it once:

```bash
git clone --depth 1 https://github.com/leather-io/extension.git /tmp/leather-source
cd /tmp/leather-source && pnpm install && pnpm prepare && pnpm build
cp -R /tmp/leather-source/dist ~/your-project/wallets/leather/dist
```

## Gherkin / `.feature` files

If the people who need to review your wallet tests don't read Playwright TypeScript, write them in Gherkin instead. `@wallets-e2e/core/bdd` ships the **wallet** steps (`I am connected to…`, `I approve the wallet popup`, `the transaction is mined`). Steps about *your* dapp (`I request a transfer…`, `a transaction id is shown`, …) are yours to write — the library only gives you `queueWalletTrigger` / `recordTransactionId` so those clicks stay inside the driver's `trigger()` callback:

```gherkin
@timeout:1_200_000
Scenario: A connected visitor sends 1 STX and it lands on chain
  Given I am connected to Stacks testnet
  When I request a transfer of 1 STX
  And I approve the wallet popup
  Then a transaction id is shown
  And the transaction is mined
```

No seed phrase, no network switching, no extension path, no popup mechanics — `Given I am connected to Stacks testnet` does the import, the network switch and the dapp connection as one step, because that is what the sentence means.

```bash
npm install --save-dev playwright-bdd    # pnpm add -D playwright-bdd in this repo
```

[`playwright-bdd`](https://vitalets.github.io/playwright-bdd/) is an **optional** peer dependency — importing `@wallets-e2e/core` never requires it, only the `@wallets-e2e/core/bdd` subpath does. Wire it with `defineBddConfig` and run `bddgen && playwright test`: `bddgen` compiles each `.feature` into a real Playwright spec, so it has to run before the suite does. Run with **`workers: 1`** (and `fullyParallel: false`) — Leather's persistent profile cannot be shared across parallel workers.

**Your own dapp steps must queue their click, never perform it.** The driver starts listening for the wallet popup *before* it runs your action; a step that clicks directly opens the popup with nobody listening and dies on a bare 10-second timeout. That is the single most common way to misuse this package:

```ts
import { queueWalletTrigger, recordTransactionId } from '@wallets-e2e/core/bdd';

When('I request a transfer of 1 STX', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('send-stx').click(); // runs inside the driver's trigger(), not here
  });
});

Then('a transaction id is shown', async ({ context, page }) => {
  const txid = (await page.getByTestId('transfer-txid').innerText()).replace(/^txid:\s*/, '').trim();
  recordTransactionId(context, txid); // feeds `Then the transaction is mined`
});
```

Two things to know before you run it: the extension has to be built first (see [Build the extension](#build-the-extension)), and **`Then the transaction is mined` spends real testnet STX and waits on real blocks — up to ~10 minutes.** Its default poll allows 15 minutes, far above Playwright's own test timeout, so any scenario using it needs a scenario-level `@timeout:` tag like the one above or Playwright kills the test long before the poll finishes.

[`examples/bdd/`](./examples/bdd/) is a real, passing setup end to end — see its [README](./examples/bdd/README.md). Full walkthrough: [`tutorials/feature-files.md`](./tutorials/feature-files.md).

## Status

Early / pre-alpha, but the core mechanism is proven: unlocking a real, source-built Leather extension, approving a real dapp connection, signing a real message, sending a real signed STX transfer, and calling a real deployed smart contract all work end to end today (video-recorded, no mocks) — confirmed on real Stacks testnet. See `examples/spike`, `examples/react-connect` and `examples/bdd` for the real, passing test suites.

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
