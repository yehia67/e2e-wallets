# @wallets-e2e/metamask

`WalletDriver` for the real [MetaMask](https://metamask.io) extension, pinned to the official **13.13.1 production artifact**, for **any EVM network**. Real import, real popups, real transactions. No mocking.


<p align="center">
  <img src="./docs/metamask-demo-full-flow.gif" alt="Playwright driving the real MetaMask extension: import, connect, ERC20 approve, deposit, EIP-2612 permit deposit" width="560">
</p>

One uninterrupted session: import → network → connect → send ETH → approve ERC20 → deposit → sign permit → deposit with permit. The GIF is a build artifact of a passing `demo-full-flow.spec.ts` — a failed run writes no GIF.

## Install

Compatibility status verified 2026-09-17: `@wallets-e2e/metamask@0.2.0` with
`@wallets-e2e/core@0.1.7`. Pin exact versions, and never substitute a repository checkout or link
for the published package.

```bash
npm install --save-dev \
  @wallets-e2e/core@0.1.7 \
  @wallets-e2e/metamask@0.2.0 \
  @playwright/test
npx playwright install chromium
```

Confirm the installed core exports `EVM_NETWORKS`, `createExtensionTest`, `createInjectedEvmRpc` and
`waitForEthTransactionMined`, and that metamask exports `createMetamaskTest`, before proceeding.

## The extension

The package brings its own. Installing it downloads and verifies the pinned 13.13.1 production
build into the package, so your repository needs no download script, no `.wallet-extensions`
directory and no extension path.

pnpm 10 and npm `--ignore-scripts` block install scripts by default, and CI may install offline. In
those cases the first test run downloads it instead — or you can do it yourself:

```bash
npx wallets-e2e-metamask          # idempotent; no-op when the pinned build is already there
npx wallets-e2e-metamask --force  # re-download, replacing whatever is there
```

To allow the install-time download under pnpm 10, add to your `package.json`:

```json
{ "pnpm": { "onlyBuiltDependencies": ["@wallets-e2e/metamask"] } }
```

Set `METAMASK_EXTENSION_PATH` to drive an unpacked build of your own instead; nothing is downloaded
over it. `metamaskExtensionPath()` returns the path in use, and `ensureMetamaskExtension()` is the
programmatic form of the command above.

## Fixture wallet

Provide a dedicated test wallet through the Playwright process environment:

```text
WALLETS_E2E_SEED_PHRASE=<local test-wallet phrase>
WALLETS_E2E_ETH_ADDRESS=<matching 0x address>
WALLETS_E2E_PASSWORD=<strong local extension password>
```

A `.env.wallet-e2e.local`, `.env.wallet-e2e` or `.env.local` in the directory you run Playwright
from — or up to four directories above it — is read automatically, so `playwright test` needs no
`--env-file` flag. Real environment variables always win over a file. Never put a funded seed phrase in a spec, report, video,
or committed fixture.

## Usage

```ts
import { EVM_NETWORKS } from '@wallets-e2e/core';
import { createMetamaskTest, metamaskDriver } from '@wallets-e2e/metamask';
import { expect } from '@playwright/test';

// The extension, its version and the "not prepared" message are already wired up.
// Everything createExtensionTest accepts — profilePrefix, headless, artifacts — is forwarded.
const test = createMetamaskTest();

test('connects on the selected network', async ({ extensionContext: context, page }) => {
  await page.goto('http://127.0.0.1:3000');

  const expectedAddress = process.env.WALLETS_E2E_ETH_ADDRESS ?? '';
  await metamaskDriver.importWallet(context, process.env.WALLETS_E2E_SEED_PHRASE ?? '');
  await metamaskDriver.switchNetwork?.(context, EVM_NETWORKS.sepolia);

  await metamaskDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
  });

  await expect(page.getByTestId('connected-address')).toContainText(expectedAddress);
});
```

Each driver call takes the dapp interaction as a trigger, then handles the popup it produces.

| Call | Approves |
|---|---|
| `importWallet(context, seedPhrase)` | onboarding, SRP, password |
| `switchNetwork(context, network)` | network selection or add-chain |
| `connectToDapp(context, trigger)` | the connect popup |
| `confirmTransaction(context, trigger)` | a transaction |
| `approveTokenPermission(context, trigger, options?)` | an ERC20 allowance, optional `spendLimit` |
| `confirmSignature(context, trigger)` | EIP-712 / EIP-2612 permit |

`approveTokenPermission` is specialized only because MetaMask renders ERC20 `approve` through a
different spending-cap screen. It is not the package's general contract API. Any standard contract
write that the dapp submits through MetaMask — mint, swap, stake, claim, vote, deploy, deposit,
withdraw, or another ABI-encoded transaction — is approved with `confirmTransaction`. The dapp,
viem, ethers, or wagmi constructs the request; the driver handles MetaMask's confirmation UI.

Read-only contract calls do not need wallet approval. Run them through the dapp or an EVM client
using `createInjectedEvmRpc(page)` to share MetaMask's active provider and network. After every write,
wait for `waitForEthTransactionMined` and assert the intended contract-state change.

## Networks

The network is an argument, not the driver's identity. Built-in chains use MetaMask's bundled provider; custom chains and explicit overrides are probed first — chain id must match and `eth_blockNumber`, `eth_gasPrice`, `eth_getBalance`, `eth_estimateGas` must all answer.

Override one chain with `WALLETS_E2E_RPC_URL_<chainId>`, or all with `WALLETS_E2E_EVM_RPC_URL`. For reads and receipts use `createInjectedEvmRpc(page)` so they share MetaMask's active provider.

## More

- [Package-consumer quick start](../../tutorials/quick-start.md)
- [HTML reports, videos, screenshots, and traces](../../tutorials/reports-and-artifacts.md)
- [Gherkin package setup](../../tutorials/feature-files.md)

## License

MIT
