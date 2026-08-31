# MetaMask and EVM flows

Use `@wallets-e2e/metamask` for the real pinned MetaMask extension. The driver implements
`WalletDriver<EvmNetwork>` and adds distinct ERC20 permission and typed-signature actions.

Package: <https://www.npmjs.com/package/@wallets-e2e/metamask>
Core dependency: <https://www.npmjs.com/package/@wallets-e2e/core>

Read [setup-and-reporting.md](setup-and-reporting.md) before installation. Do not install the known
incompatible published MetaMask 0.1.0/core 0.1.3 pair. Package consumption is blocked until registry
metadata shows a compatible release; do not replace it with a toolkit source checkout.

## Smart-contract coverage and boundary

The package is not limited to ERC20 approval or to the example vault. It can test ordinary
interactions with any EVM smart contract that the dapp can submit through the supported MetaMask
13.13.1 transaction UI: mint, burn, transfer, swap, stake, claim, vote, deploy, deposit, withdraw,
and arbitrary ABI-encoded writes all use `confirmTransaction`.

The responsibility boundary is important:

- The dapp, viem, ethers, wagmi, or another client constructs the ABI call and invokes the injected
  provider. The wallet driver does not take an ABI/function name and manufacture the transaction.
- `metamaskDriver.confirmTransaction(context, trigger)` starts listening, runs the dapp action that
  submits the request, and approves MetaMask's standard transaction confirmation screen.
- Contract reads (`eth_call`, `balanceOf`, view/pure functions) do not open approval UI. Execute them
  through the dapp or an EVM client using `createInjectedEvmRpc(page)`.
- ERC20 `approve` is a contract write too, but current MetaMask renders a specialized token
  permission/spending-cap screen. That one UI shape uses `approveTokenPermission`; it is an extra
  action, not a restriction on other contracts.
- EIP-712/EIP-2612 typed-data signing is off-chain and uses `confirmSignature`. A later contract
  submission that consumes the signature uses `confirmTransaction`.

Support means standard requests and confirmation screens exposed by the pinned extension. Flows
that depend on a hardware wallet, MetaMask Snap, smart-account/batch-specific UI, unsupported chain,
or a future redesigned screen require their own proof or driver extension.

## Driver actions

```ts
import {
  EVM_NETWORKS,
  chainIdToHex,
  createInjectedEvmRpc,
  waitForEthTransactionMined,
} from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
```

| Action | Use it for |
|---|---|
| `importWallet(context, seedPhrase)` | Fresh MetaMask onboarding and address verification. |
| `switchNetwork(context, network)` | Built-in or custom EVM network selection. |
| `connectToDapp(context, trigger)` | `eth_requestAccounts` / connection approval. |
| `confirmTransaction(context, trigger)` | Any standard transaction: ETH sends, arbitrary contract writes, deployment, deposits, swaps, mints, and permit submission. |
| `approveTokenPermission(context, trigger, options?)` | ERC20 allowance UI; optional `spendLimit`. |
| `confirmSignature(context, trigger)` | EIP-712 typed data and EIP-2612 permit signatures. |

The deprecated `switchToTestnetNetwork` maps to Sepolia only for compatibility. New tests should
pass an `EvmNetwork` explicitly.

## Generic contract write and read

The test remains contract-agnostic because the dapp owns the ABI call:

```ts
const rpc = createInjectedEvmRpc(page);

// The dapp button may call viem writeContract(), ethers contract.method(), wagmi, or raw
// ethereum.request({ method: 'eth_sendTransaction', ... }).
await metamaskDriver.confirmTransaction(context, async () => {
  await page.getByTestId('submit-contract-write').click();
});

const txHash = extractHash(await page.getByTestId('contract-status').innerText());
expect(await waitForEthTransactionMined(txHash, { requester: rpc })).toBe('success');

// Read the resulting state through the same injected provider, directly or via viem custom(rpc).
const state = await readContractState(rpc);
expect(state).toEqual(expectedState);
```

Use contract-specific assertions: balance delta, owner, nonce, emitted-event-derived UI, position,
allowance, stored value, or another meaningful state transition. A successful receipt without the
expected state change is not sufficient acceptance evidence.

## Import, network, connection, and provider verification

```ts
import { expect } from '@playwright/test';
import { EVM_NETWORKS, chainIdToHex, createInjectedEvmRpc } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { test } from './fixtures.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const seedPhrase = required('WALLETS_E2E_SEED_PHRASE');
const expectedAddress = required('WALLETS_E2E_ETH_ADDRESS');

test('connects MetaMask on Sepolia', async ({ extensionContext: context, page }) => {
  await page.goto('/');
  const account = await metamaskDriver.importWallet(context, seedPhrase);
  expect(account.address.toLowerCase()).toBe(expectedAddress.toLowerCase());

  await metamaskDriver.switchNetwork?.(context, EVM_NETWORKS.sepolia);
  await metamaskDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
  });

  await expect(page.getByTestId('connected-address')).toContainText(expectedAddress, {
    ignoreCase: true,
  });

  const rpc = createInjectedEvmRpc(page);
  expect(await rpc.request({ method: 'eth_chainId' })).toBe(
    chainIdToHex(EVM_NETWORKS.sepolia.chainId),
  );
});
```

The driver handles already-authorized connections as well as popup approvals. Do not add an
unconditional manual click on a guessed MetaMask confirmation button after calling the driver.

## Network and RPC policy

`EVM_NETWORKS` includes `sepolia`, `baseSepolia`, `mainnet`, and `localhost`. An `EvmNetwork` carries
its decimal chain ID, display name, RPC candidates, currency symbol, explorer, and built-in/testnet
flags.

- Built-in Sepolia: enable test networks and select the existing network. Do not replace its RPC
  unless the caller supplied an explicit override.
- Custom network: probe a candidate RPC, add the network in MetaMask, verify the chain ID, and select
  it.
- Chain override: `WALLETS_E2E_RPC_URL_<chainId>`.
- All-EVM override: `WALLETS_E2E_EVM_RPC_URL`.
- HTTP probing rejects wrong-chain nodes, redirects, HTML/challenge pages, auth/paywall responses,
  rate limits, missing results, and endpoints that cannot estimate gas.

For browser reads and receipts, use `createInjectedEvmRpc(page)`. It calls `window.ethereum.request`
inside the dapp, so the test cannot accidentally poll a different public endpoint or chain. Use
`resolveWorkingRpc(network)` for deployment scripts and other explicit HTTP clients.

## ETH transaction

```ts
const rpc = createInjectedEvmRpc(page);

await metamaskDriver.confirmTransaction(context, async () => {
  await page.getByTestId('send-eth').click();
});

const txHash = (await page.getByTestId('tx-hash').innerText()).trim();
expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);
expect(
  await waitForEthTransactionMined(txHash, { requester: rpc, timeoutMs: 8 * 60_000 }),
).toBe('success');
```

Fail immediately if the dapp displays an error instead of a hash. `waitForEthTransactionMined`
returns `success` or `reverted`, polls pending receipts, throws on RPC errors, and throws on timeout.
The requester takes precedence over `network` or `rpcUrl` when more than one is provided.

## ERC20 approve then deposit

Capture the vault/account balance before the flow. Approval and deposit are separate transactions;
wait for approval to mine before triggering the deposit.

```ts
await metamaskDriver.approveTokenPermission(context, async () => {
  await page.getByTestId('approve-token').click();
});
const approvalHash = extractHash(await page.getByTestId('deposit-status').innerText());
expect(await waitForEthTransactionMined(approvalHash, { requester: rpc })).toBe('success');

await metamaskDriver.confirmTransaction(context, async () => {
  await page.getByTestId('deposit-after-approve').click();
});
const depositHash = extractHash(await page.getByTestId('deposit-status').innerText());
expect(await waitForEthTransactionMined(depositHash, { requester: rpc })).toBe('success');
```

The default token permission accepts the dapp-requested allowance. Pass `{ spendLimit: 'max' }` or
a non-negative numeric limit only when the test explicitly requires that UI path.

## EIP-2612 permit then deposit

The permit is an off-chain typed-data signature; submitting `depositWithPermit` is an on-chain
transaction. Use different driver actions:

```ts
await metamaskDriver.confirmSignature(context, async () => {
  await page.getByTestId('deposit-permit-sign').click();
});
await expect(page.getByTestId('deposit-status')).toHaveText('permit-signed');

await metamaskDriver.confirmTransaction(context, async () => {
  await page.getByTestId('deposit-permit-submit').click();
});
const permitDepositHash = extractHash(await page.getByTestId('deposit-status').innerText());
expect(await waitForEthTransactionMined(permitDepositHash, { requester: rpc })).toBe('success');
```

Assert the final contract balance delta, not an absolute balance, because a shared deployed vault can
accumulate state across runs. In a full approve-plus-permit flow, the expected delta is two deposit
amounts.

## Live-network gates

Keep import/network/connect smoke tests non-spending. Gate gas-spending Sepolia specs, for example:

```ts
test.skip(
  process.env.WALLETS_E2E_RUN_SEPOLIA !== '1',
  'Set WALLETS_E2E_RUN_SEPOLIA=1 to allow live Sepolia gas/token spending.',
);
```

Before an opted-in run, verify the fixture address, deployed chain ID and contract addresses, ETH for
gas, token balance, and deposit amount. Never print the seed phrase. A self-transfer returns its ETH
value but still consumes gas; approval and each deposit consume gas, and deposits consume tokens.
