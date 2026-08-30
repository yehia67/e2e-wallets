# @wallets-e2e/metamask

`WalletDriver` adapter for the real [MetaMask](https://metamask.io) browser extension, pinned to the official **13.13.1 production artifact** used by Synpress, for **any EVM network** — part of [wallets-e2e](https://github.com/yehia67/e2e-wallets). Real import, real connect popup, real transaction and EIP-712 signature approvals. No mocking.

The network is an argument, not the driver's identity: `switchNetwork(context, network)` takes an `EvmNetwork` value. Built-in networks use MetaMask's bundled provider unless the caller explicitly supplies an RPC override; custom networks and overrides are probed before MetaMask adds them. `EVM_NETWORKS.sepolia` is what this repo's own tests pass.

## The full flow, recorded

<p align="center">
  <img src="https://raw.githubusercontent.com/yehia67/e2e-wallets/main/docs/metamask-demo-full-flow.gif" alt="Playwright driving the real MetaMask extension end to end: importing a seed phrase, selecting the network, connecting the spike dapp, sending ETH, approving an ERC20 allowance, and depositing into the test vault" width="560">
</p>

One uninterrupted session against the real extension — no mocks, no stubbed provider, every popup a real MetaMask popup:

| # | Step | Driver call |
|---|------|-------------|
| 1 | Import the fixture seed phrase and unlock | `importWallet(context, seedPhrase)` |
| 2 | Select built-in Sepolia without replacing its RPC | `switchNetwork(context, network)` |
| 3 | Approve the dapp connection | `connectToDapp(context, trigger)` |
| 4 | Send ETH and wait for a real receipt | `confirmTransaction(context, trigger)` |
| 5 | Approve an ERC20 allowance | `approveTokenPermission(context, trigger)` |
| 6 | Deposit into the vault, assert the balance moved | `confirmTransaction(context, trigger)` |
| 7 | Sign an EIP-2612 permit | `confirmSignature(context, trigger)` |
| 8 | Deposit with permit and assert the total delta | `confirmTransaction(context, trigger)` |

The image is absolute-URL'd on purpose: `files` ships only `lib`, `src` and `fixtures`, so a relative path renders on GitHub but breaks on npmjs.com.

> **The GIF is a build artifact of a passing test, never a hand-made recording.** `record-demo-gif.sh` runs `demo-full-flow.spec.ts` and converts the Playwright video only if every step above passed. A failed or partial run writes no GIF, so the image can never drift into showing a flow that does not work.

### Regenerating it

Needs a funded fixture wallet and deployed contracts, because steps 4-8 are real on-chain transactions:

```bash
# Fund the wallets/metamask/.env.local address on your target network, then:
pnpm build:metamask
cd examples/metamask-spike && forge build && cd ../../..
node examples/metamask-spike/scripts/deploy.mjs
bash wallets/metamask/scripts/record-demo-gif.sh
```

The script writes `docs/metamask-demo-full-flow.gif` and needs `ffmpeg` on `PATH`; without it the raw `.webm` path is printed to convert by hand.

## Install

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/metamask @playwright/test
```

`@playwright/test` is a peer dependency.

Download and verify the pinned official MetaMask 13.13.1 production extension once (from the monorepo root):

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
import { EVM_NETWORKS, launchContext } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';

test('connects on the selected network', async () => {
  const context = await launchContext({
    extensionPath: 'wallets/metamask/dist',
    userDataDir: '.tmp/metamask-profile',
    recordVideoDir: 'test-results/videos',
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3456');

  await metamaskDriver.importWallet(context, wallet.seedPhrase);
  await metamaskDriver.switchNetwork?.(context, EVM_NETWORKS.sepolia);

  await metamaskDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
  });

  await expect(page.getByTestId('connected-address')).toContainText(wallet.address);
  await context.close();
});
```

### How the network switch works

MetaMask 13.13.1's production artifact includes its working built-in network provider. The driver never replaces Sepolia's RPC during the default browser flow. The dapp page must be open before `switchNetwork`; MetaMask approves the origin-specific network change and the driver verifies it with the injected provider's `eth_chainId`.

| The chain is… | What the driver does |
|---|---|
| built in, no override | selects the existing chain through `wallet_switchEthereumChain`; no HTTP RPC is chosen or edited |
| custom or explicit override | probes the caller's candidates, adds/updates the chain through MetaMask, then verifies its chain ID |

Every explicit/custom HTTP RPC is probed before MetaMask is pointed at it: the chain id must match, and `eth_blockNumber`, `eth_gasPrice`, `eth_getBalance` and `eth_estimateGas` must all answer. HTTP 401/402/403/407/429/451 and paywall wording in a JSON-RPC error both disqualify an endpoint.

Override per chain with `WALLETS_E2E_RPC_URL_<chainId>` (e.g. `WALLETS_E2E_RPC_URL_11155111`), or for every chain with `WALLETS_E2E_EVM_RPC_URL`. Browser reads and receipt polling should use `createInjectedEvmRpc(page)`, so they share MetaMask's active provider instead of selecting an independent endpoint.

Success is asserted from the dapp's real injected provider: `eth_chainId` must match the requested network.

## What's exported

- `metamaskDriver` / `MetaMaskDriver` — `importWallet`, `switchNetwork(context, network)`, `connectToDapp`, `confirmTransaction`, `approveTokenPermission`, and `confirmSignature` (EIP-712 / ERC20 permit).
- `./fixtures/wallet.js` — reads `WALLETS_E2E_SEED_PHRASE`, `WALLETS_E2E_ETH_ADDRESS`, `WALLETS_E2E_PASSWORD` from the environment (auto-loads `wallets/metamask/.env.local` when present).

## Gherkin / `.feature` files

Product-language scenarios live in **`examples/metamask-bdd/`** (same pattern as Leather's `examples/bdd/`):

```gherkin
Feature: MetaMask on an EVM network (metamask-spike dapp)

  Scenario: The spike dapp shows the connected fixture address
    Given I am connected to MetaMask on Sepolia
    Then my wallet address is shown

  @sepolia-spending
  Scenario: A visitor deposits ERC20 via approve then deposit
    Given I am connected to MetaMask on Sepolia
    When I request ERC20 token approval
    And I approve the token permission popup
    And the EVM transaction is mined
    When I request an ERC20 deposit after approve
    And I approve the wallet popup
    And the EVM transaction is mined
    Then my vault balance increased by one token
```

Run:

```bash
pnpm build:metamask
cd examples/metamask-spike && forge build && cd ../../..
node examples/metamask-spike/scripts/deploy.mjs
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-metamask-bdd test
# Add WALLETS_E2E_RUN_SEPOLIA=1 to include gas-spending scenarios.
```

See also **`examples/metamask-spike/`** for plain Playwright specs (connect, ETH send, ERC20 approve/permit).

## Full docs

- [examples/metamask-spike/README.md](../../examples/metamask-spike/README.md) — contracts, deploy script, spike dapp
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — MetaMask setup section
- [tutorials/feature-files.md](../../tutorials/feature-files.md) — Gherkin patterns (`queueWalletTrigger`, approval steps)

## License

MIT
