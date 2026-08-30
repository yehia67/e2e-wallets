# @wallets-e2e/metamask

`WalletDriver` for the real [MetaMask](https://metamask.io) extension, pinned to the official **13.13.1 production artifact**, for **any EVM network**. Real import, real popups, real transactions. No mocking.


<p align="center">
  <img src="./docs/metamask-demo-full-flow.gif" alt="Playwright driving the real MetaMask extension: import, connect, ERC20 approve, deposit, EIP-2612 permit deposit" width="560">
</p>

One uninterrupted session: import → network → connect → send ETH → approve ERC20 → deposit → sign permit → deposit with permit. The GIF is a build artifact of a passing `demo-full-flow.spec.ts` — a failed run writes no GIF.

## Install

Compatibility status verified 2026-08-30: published MetaMask `0.1.0` imports EVM APIs that published
core `0.1.3` does not export. There is currently no working npm version pair. Do not clone or link
repository source as a substitute. After compatible versions are published, install the verified
pair in your dapp:

```bash
WALLETS_CORE_VERSION=replace-with-verified-version
WALLETS_METAMASK_VERSION=replace-with-verified-version
npm install --save-dev \
  "@wallets-e2e/core@${WALLETS_CORE_VERSION}" \
  "@wallets-e2e/metamask@${WALLETS_METAMASK_VERSION}" \
  @playwright/test
npx playwright install chromium
```

The replacement values are deliberately invalid. Confirm the installed core exports `EVM_NETWORKS`,
`createExtensionTest`, `createInjectedEvmRpc`, and `waitForEthTransactionMined` before proceeding.

The package supplies the driver; the browser extension is a separate artifact. Download the pinned
official production build into your dapp:

```bash
mkdir -p .wallet-extensions/metamask-13.13.1
curl --fail --location \
  https://github.com/MetaMask/metamask-extension/releases/download/v13.13.1/metamask-chrome-13.13.1.zip \
  --output .wallet-extensions/metamask-chrome-13.13.1.zip
unzip -q -o .wallet-extensions/metamask-chrome-13.13.1.zip \
  -d .wallet-extensions/metamask-13.13.1
node -e "const m=require('./.wallet-extensions/metamask-13.13.1/manifest.json'); if(m.version!=='13.13.1') throw new Error('Unexpected MetaMask '+m.version)"
```

## Fixture wallet

Provide a dedicated test wallet through the Playwright process environment:

```text
WALLETS_E2E_SEED_PHRASE=<local test-wallet phrase>
WALLETS_E2E_ETH_ADDRESS=<matching 0x address>
WALLETS_E2E_PASSWORD=<strong local extension password>
```

Inject them before Node imports the driver. Never put a funded seed phrase in a spec, report, video,
or committed fixture.

## Usage

```ts
import { resolve } from 'node:path';
import { EVM_NETWORKS, createExtensionTest } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { expect } from '@playwright/test';

const test = createExtensionTest({
  extensionPath: resolve('.wallet-extensions/metamask-13.13.1'),
  extensionName: 'MetaMask 13.13.1',
  onMissingExtension: 'throw',
});

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
