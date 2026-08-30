# @wallets-e2e/core

Shared machinery every wallet driver in the [wallets-e2e](https://github.com/yehia67/e2e-wallets) monorepo builds on — launches the real, extension-loaded Playwright browser context, resolves the extension's runtime ID, defines the `WalletDriver` interface every wallet adapter implements, and confirms transactions on-chain via RPC.

Part of a toolkit for driving **real** wallet browser extensions in Playwright E2E tests — real unlock, real popup approval, real signatures, real on-chain transactions. No mocking. [Leather](https://www.npmjs.com/package/@wallets-e2e/leather) (Stacks) and [MetaMask](https://www.npmjs.com/package/@wallets-e2e/metamask) (any EVM network) are the adapters built on top of this package.

## Install

```bash
npm install --save-dev @wallets-e2e/core @playwright/test
```

`@playwright/test` is a peer dependency — this package uses your project's own Playwright install, not a bundled copy.

## What's exported

- `launchContext({ extensionPath, userDataDir, recordVideoDir, headless? })` — the one place a persistent Chromium context with a wallet extension loaded gets created.
- `resolveExtensionId(context)` — the extension's runtime ID, resolved from its live service worker (never a pre-pinned manifest key).
- `WalletDriver<TNetwork>` — the interface every wallet adapter implements (`importWallet`, `connectToDapp`, `confirmTransaction`, optional `switchNetwork(context, network)` and `confirmSignature`). The deprecated `switchToTestnetNetwork` remains as a compatibility bridge.
- `selectWalletInStacksConnectModal(page, walletName)` — picks a wallet in `@stacks/connect`'s own in-page wallet picker.
- `waitForTransactionMined(txid, options)` — polls a Stacks API until a transaction is confirmed, never trusting "the popup closed" as proof.
- `Chain`, `StacksNetwork`, `SupportedStacksNetwork`, `STACKS_NETWORK_RPC_URLS`, `TESTNET_RPC_URL` — the Stacks network constants this toolkit's RPC checks resolve against.
- `EvmNetwork`, `EVM_NETWORKS` (`sepolia`, `mainnet`, `localhost`) — an EVM network as a value: chain id, name, RPC candidates, currency symbol, `testnet`/`builtIn` flags.
- `chainIdToHex(chainId)` / `chainIdToCaip(chainId)` — `11155111` → `'0xaa36a7'` / `'eip155:11155111'`, the two forms wallet UIs build their network test-IDs from.
- `evmRpcCandidates(network)`, `probeEvmRpc(rpcUrl, chainId)`, `resolveWorkingRpc(network)` — ordered RPC failover: the env override (`WALLETS_E2E_RPC_URL_<chainId>`, then `WALLETS_E2E_EVM_RPC_URL`) first, each candidate proved to answer for the right chain before it is used.
- `createInjectedEvmRpc(page)` — adapts the active `window.ethereum` provider to the package's `EvmRpcRequester` port.
- `waitForEthTransactionMined(txHash, { requester | network | rpcUrl, ... })` — the EVM counterpart to `waitForTransactionMined`; an injected requester takes precedence over HTTP options.
- Deprecated compatibility aliases remain exported: `CHAIN`, `SEPOLIA_RPC_URL`, and `SEPOLIA_RPC_URLS`.

## Full docs

See the [monorepo README](https://github.com/yehia67/e2e-wallets#readme) and [quick-start tutorial](https://github.com/yehia67/e2e-wallets/blob/main/tutorials/quick-start.md) for a complete, real, working example.

## License

MIT
