# @wallets-e2e/metamask

`WalletDriver` adapter for the real [MetaMask](https://metamask.io) browser extension (official test build), targeting **Ethereum Sepolia** — part of [wallets-e2e](https://github.com/yehia67/e2e-wallets). Real import, real connect popup, real transaction and EIP-712 signature approvals. No mocking.

<p align="center">
  <img src="../../docs/metamask-demo-full-flow.gif" alt="Playwright driving the real MetaMask extension on Sepolia: unlock via seed import, switch to Sepolia, connect the spike dapp, send Sepolia ETH, approve ERC20 allowance, and deposit into the test vault" width="560">
  <br>
  <em>Unlock → Sepolia → connect → ETH transfer → ERC20 approve → deposit. GIF is produced only after <code>record-demo-gif.sh</code> runs the full demo test successfully (not from connect-only runs).</em>
</p>

Regenerate the GIF only after the **full** spike demo passes (funded wallet + deployed contracts required):

```bash
# Fund wallets/metamask/.env.local address on Sepolia, then:
pnpm build:metamask
cd examples/metamask-spike && forge build && cd ../../..
node examples/metamask-spike/scripts/deploy-sepolia.mjs
bash wallets/metamask/scripts/record-demo-gif.sh
```

The script runs `examples/metamask-spike/tests/demo-full-flow.spec.ts` (unlock, network switch, connect, mined ETH send, ERC20 approve + deposit). If any step fails, **no GIF is written**.

## Install

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/metamask @playwright/test
```

`@playwright/test` is a peer dependency.

Build the MetaMask test extension once (from the monorepo root):

```bash
pnpm build:metamask
```

## Fixture wallet (keep your funded address)

MetaMask has **no checked-in seed phrase**. Generate once locally:

```bash
node wallets/metamask/scripts/generate-fixture-wallet.mjs
```

That writes `wallets/metamask/.env.local` (gitignored) and prints the Sepolia address to fund.

**If you already sent ETH to an address, do not run `generate` with `--force`** — that creates a new wallet. The script **preserves** an existing `.env.local` by default (same seed and address). It only adds `WALLETS_E2E_ETH_PRIVATE_KEY` if missing.

Tests load secrets automatically from `wallets/metamask/.env.local` via `fixtures/wallet.ts` — **do not `source` that file in bash** (seed phrases contain spaces).

## Quick example

```ts
import { test, expect } from '@playwright/test';
import { launchContext } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';

test('connects on Sepolia', async () => {
  const context = await launchContext({
    extensionPath: 'wallets/metamask/dist',
    userDataDir: '.tmp/metamask-profile',
    recordVideoDir: 'test-results/videos',
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3456');

  await metamaskDriver.importWallet(context, wallet.seedPhrase);
  await metamaskDriver.switchToTestnetNetwork?.(context);

  await metamaskDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
  });

  await expect(page.getByTestId('connected-address')).toContainText(wallet.address);
  await context.close();
});
```

Sepolia RPC (no API key / no login): MetaMask's test build ships a broken Infura key, so the driver points Sepolia at a local `127.0.0.1` proxy that forwards to a public endpoint (default `https://ethereum-sepolia-rpc.publicnode.com`, with failover).

## What's exported

- `metamaskDriver` — `importWallet`, `switchToTestnetNetwork` (Sepolia), `connectToDapp`, `confirmTransaction`, `confirmSignature` (EIP-712 / ERC20 permit).
- `./fixtures/wallet.js` — reads `WALLETS_E2E_SEED_PHRASE`, `WALLETS_E2E_ETH_ADDRESS`, `WALLETS_E2E_PASSWORD` from the environment (auto-loads `wallets/metamask/.env.local` when present).

## Gherkin / `.feature` files

Product-language scenarios live in **`examples/metamask-bdd/`** (same pattern as Leather's `examples/bdd/`):

```gherkin
Feature: MetaMask on Sepolia (metamask-spike dapp)

  Scenario: The spike dapp shows the connected fixture address
    Given I am connected to MetaMask on Sepolia
    Then my wallet address is shown

  Scenario: A visitor deposits ERC20 via approve then deposit
    Given I am connected to MetaMask on Sepolia
    When I request ERC20 token approval
    And I approve the wallet popup
    When I request an ERC20 deposit after approve
    And I approve the wallet popup
    Then my vault balance increased by one token
```

Run:

```bash
pnpm build:metamask
cd examples/metamask-spike && forge build && cd ../../..
node examples/metamask-spike/scripts/deploy-sepolia.mjs
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-metamask-bdd test
```

See also **`examples/metamask-spike/`** for plain Playwright specs (connect, ETH send, ERC20 approve/permit).

## Full docs

- [examples/metamask-spike/README.md](../../examples/metamask-spike/README.md) — contracts, deploy script, spike dapp
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — MetaMask setup section
- [tutorials/feature-files.md](../../tutorials/feature-files.md) — Gherkin patterns (`queueWalletTrigger`, approval steps)

## License

MIT
