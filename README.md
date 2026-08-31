# wallets-e2e

Playwright fixtures for driving **real** wallet browser extensions in end-to-end tests — real unlock, real connection approval, real transaction signature. No mocking. Leather on Stacks, MetaMask on any EVM network.

[![@wallets-e2e/core](https://img.shields.io/npm/v/@wallets-e2e/core?label=%40wallets-e2e%2Fcore)](https://www.npmjs.com/package/@wallets-e2e/core)
[![@wallets-e2e/leather](https://img.shields.io/npm/v/@wallets-e2e/leather?label=%40wallets-e2e%2Fleather)](https://www.npmjs.com/package/@wallets-e2e/leather)
[![@wallets-e2e/metamask](https://img.shields.io/npm/v/@wallets-e2e/metamask?label=%40wallets-e2e%2Fmetamask)](https://www.npmjs.com/package/@wallets-e2e/metamask)
[![license](https://img.shields.io/npm/l/@wallets-e2e/core)](./LICENSE)

| Wallet | Package | Chains |
|---|---|---|
| [Leather](./wallets/leather/) | [`@wallets-e2e/leather`](https://www.npmjs.com/package/@wallets-e2e/leather) | Stacks |
| [MetaMask](./wallets/metamask/) | [`@wallets-e2e/metamask`](https://www.npmjs.com/package/@wallets-e2e/metamask) | any EVM network |

More wallets are coming — [contributions welcome](./CONTRIBUTING.md).

<p align="center">
  <img src="./docs/demo-full-flow.gif" alt="Playwright driving the real Leather extension end to end: unlocking with a 24-word seed, switching to testnet, approving a signed message, a real STX transfer, and a real smart-contract call" width="560">
  <br>
  <em>Real footage from this repo's own test suite: unlock → network switch → sign → transfer → contract call. Every popup real, every txid real.</em>
</p>

## Install

Install the wallet driver and core package in **your dapp repository**. Do not clone or link this
repository to consume the library.

```bash
npm install --save-dev @wallets-e2e/core@0.1.3 @wallets-e2e/leather@0.1.3 @playwright/test
npx playwright install chromium
```

Registry compatibility verified on 2026-08-30: the Leather pair above is published. Published
MetaMask `0.1.0` imports EVM APIs absent from published core `0.1.3`, so npm MetaMask consumption is
currently blocked pending a compatible release. Do not use a source checkout as a hidden fallback.
Before installing MetaMask, verify that the latest core exports `EVM_NETWORKS`,
`createInjectedEvmRpc`, and `waitForEthTransactionMined`, then install the mutually compatible
published versions.

## Use it

```ts
// tests/connect.spec.ts
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

test('connects to my dapp', async () => {
  const context = await launchContext({
    extensionPath: '.wallet-extensions/leather/dist',
    userDataDir: '.tmp/my-test-profile',
    recordVideoDir: 'test-results/videos',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your dapp

  await leatherDriver.importWallet(context, wallet.seedPhrase);
  await leatherDriver.switchToTestnetNetwork?.(context);

  await leatherDriver.connectToDapp(context, async () => {
    await page.getByRole('button', { name: 'Connect Wallet' }).click(); // your button
    await selectWalletInStacksConnectModal(page, 'Leather');
  });

  await expect(page.getByTestId('connected-address')).toBeVisible();
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

The JavaScript driver comes from npm. Chromium separately needs an unpacked Leather extension.
Download a reviewed Leather source archive, build it once, and point `extensionPath` at its `dist`
directory. Keep it in a caller-owned, gitignored `.wallet-extensions` directory and pin the reviewed
commit rather than following a moving branch.

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

→ **[Full package-consumer walkthrough](./tutorials/feature-files.md)**

## MetaMask / EVM

The same port, a different chain. `switchNetwork` takes an `EvmNetwork` **value** rather than naming a chain. Built-in Sepolia uses MetaMask's own provider unchanged; custom networks and explicit RPC overrides are validated before they are added.

```ts
import {
  EVM_NETWORKS,
  createInjectedEvmRpc,
  waitForEthTransactionMined,
} from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';

await metamaskDriver.importWallet(context, process.env.WALLETS_E2E_SEED_PHRASE ?? '');
await metamaskDriver.switchNetwork?.(context, EVM_NETWORKS.sepolia);

await metamaskDriver.connectToDapp(context, async () => {
  await page.getByTestId('connect-wallet').click();
});

await metamaskDriver.approveTokenPermission(context, async () => {
  await page.getByTestId('approve-token').click();
});

// Poll through the same injected provider MetaMask is using, never a second public RPC.
const status = await waitForEthTransactionMined(txHash, {
  requester: createInjectedEvmRpc(page),
});
```

MetaMask requires `WALLETS_E2E_SEED_PHRASE`, `WALLETS_E2E_ETH_ADDRESS`, and
`WALLETS_E2E_PASSWORD` in the Playwright process. Use a dedicated local test wallet and fund only
its testnet address. The [MetaMask package guide](./wallets/metamask/README.md) shows the pinned
official extension download and the package-only fixture.

→ **[`wallets/metamask/README.md`](./wallets/metamask/README.md)**

## Reports and artifacts

A wallet test fails inside a popup that has already closed. Two calls put every result in an HTML report, with a video and screenshot of **every** open page — the dapp *and* the wallet's own popup — for passed and failed tests. Failures also retain a trace.

These reporting exports are not present in published core `0.1.3`; use this section only after a
compatible core package is published and verified. Do not substitute local source.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

export default withWalletReporting(defineConfig({ testDir: './tests', workers: 1 }));
```

```ts
// tests/fixtures.ts — replaces the ~34 lines of profile/launch/cleanup boilerplate
import { createExtensionTest } from '@wallets-e2e/core';

export const test = createExtensionTest({
  extensionPath: '.wallet-extensions/leather/dist',
  extensionName: 'Leather',
  buildCommand: 'npm run wallet:prepare', // message only; define this in your application
  onMissingExtension: 'throw',
});
```

```bash
npx playwright test
npx playwright show-report playwright-report
```

Traces and screenshots come from Playwright itself — it does see a `launchPersistentContext`. Only the video needs attaching, which is the part `createExtensionTest` does.

→ **[Full walkthrough](./tutorials/reports-and-artifacts.md)** — which artifact answers which question, the `video`/`screenshot`/`trace` modes and their precedence, and what to upload from CI.

## Bring your own account

`wallet` reads every field from an environment variable, falling back to a checked-in, no-value default:

```bash
WALLETS_E2E_SEED_PHRASE="your twenty four word secret key" \
WALLETS_E2E_MAINNET_ADDRESS="SP..." \
WALLETS_E2E_TESTNET_ADDRESS="ST..." \
npx playwright test
```

Both addresses are required if you override the seed — `importWallet` verifies the unlocked account against `mainnetAddress` and fails loudly on a mismatch.

Keep the seed in the environment, not in source — the checked-in default is a throwaway.

## Status

Pre-alpha, but the mechanism is proven end to end on real Stacks testnet — unlock, dapp connection,
message signature, signed STX transfer, and a deployed contract call, all video-recorded with no
mocks. Consumer documentation nevertheless describes only public packages; unpublished repository
code is not presented as an installation route.

## Using this with an AI coding agent

[`claude-skill/wallets-e2e/`](./claude-skill/wallets-e2e/) is a portable agent skill covering real MetaMask and Leather dapp flows, arbitrary standard smart-contract interactions, live-chain verification, BDD, debugging, and HTML reports with videos and success/failure screenshots. Claude Code discovers it from `.claude/skills`; other agentic systems can consume the same `SKILL.md` and focused references using their own skill/import convention.

Copy it into a Claude Code project:

```bash
cp -R claude-skill/wallets-e2e ~/your-project/.claude/skills/wallets-e2e
```

An MCP server is planned, not built yet.

## Contributing

New wallet adapters are welcome. [`CONTRIBUTING.md`](./CONTRIBUTING.md) is the explicitly
maintainer-only guide; it is the sole place where repository workspace paths and internal commands
belong.

## License

MIT — see [`LICENSE`](./LICENSE).
