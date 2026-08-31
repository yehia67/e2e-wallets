# @wallets-e2e/core

Public package machinery for wallet drivers and consuming dapps: launch a real extension-loaded
Playwright context, resolve the extension runtime ID, use the shared `WalletDriver` interface, poll
on-chain transactions, and generate reviewable reports.

Part of a toolkit for driving **real** wallet browser extensions in Playwright E2E tests — real unlock, real popup approval, real signatures, real on-chain transactions. No mocking. [Leather](https://www.npmjs.com/package/@wallets-e2e/leather) (Stacks) and [MetaMask](https://www.npmjs.com/package/@wallets-e2e/metamask) (any EVM network) are the adapters built on top of this package.

## Install

```bash
npm install --save-dev @wallets-e2e/core @playwright/test
```

`@playwright/test` is a peer dependency — this package uses your project's own Playwright install, not a bundled copy.

## What's exported

- `launchContext({ extensionPath, userDataDir?, recordVideoDir?, headless? })` — the one place a persistent Chromium context with a wallet extension loaded gets created. Omit `recordVideoDir` and the context records nothing.
- `createExtensionTest({ extensionPath, base?, artifacts?, profilePrefix?, extensionName?, buildCommand?, onMissingExtension? })` — a Playwright `test` whose `context` / `page` / `extensionContext` are a real extension-loaded persistent context, on a fresh temp profile that is cleaned up afterwards. The recorded video is attached to the test that produced it; Playwright's own machinery supplies the trace and screenshots (one per open page, so the wallet's popup is captured too). Pass `base` to build on playwright-bdd's `test`.
- `withWalletReporting(config)` — wraps a Playwright config with the list + unfiltered HTML reporters and the `video` / `screenshot` / `trace` modes, never overwriting anything you set yourself. Videos and screenshots are retained for passed and failed tests by default; traces remain failure-only.
- `walletReporters({ outputFolder?, open? })` — just the reporter pair, for configs that assemble their own.
- `ArtifactMode`, `WalletArtifactOptions`, `DEFAULT_ARTIFACT_MODES`, `ExtensionFixtures`, `CreateExtensionTestOptions` — the artifact retention vocabulary and the factory's option and fixture shapes.
- `resolveExtensionId(context)` — the extension's runtime ID, resolved from its live service worker (never a pre-pinned manifest key).
- `WalletDriver<TNetwork>` — the interface every wallet adapter implements (`importWallet`, `connectToDapp`, `confirmTransaction`, optional `switchNetwork(context, network)` and `confirmSignature`). The deprecated `switchToTestnetNetwork` remains as a compatibility bridge.
- `selectWalletInStacksConnectModal(page, walletName)` — picks a wallet in `@stacks/connect`'s own in-page wallet picker.
- `waitForTransactionMined(txid, options)` — polls a Stacks API until a transaction is confirmed, never trusting "the popup closed" as proof.
- `Chain`, `StacksNetwork`, `SupportedStacksNetwork`, `STACKS_NETWORK_RPC_URLS`, `TESTNET_RPC_URL` — the Stacks network constants this toolkit's RPC checks resolve against.
- `EvmNetwork`, `EVM_NETWORKS` (`sepolia`, `baseSepolia`, `mainnet`, `localhost`) — an EVM network as a value: chain id, name, RPC candidates, currency symbol, `testnet`/`builtIn` flags.
- `chainIdToHex(chainId)` / `chainIdToCaip(chainId)` — `11155111` → `'0xaa36a7'` / `'eip155:11155111'`, the two forms wallet UIs build their network test-IDs from.
- `evmRpcCandidates(network)`, `probeEvmRpc(rpcUrl, chainId)`, `resolveWorkingRpc(network)` — ordered RPC failover: the env override (`WALLETS_E2E_RPC_URL_<chainId>`, then `WALLETS_E2E_EVM_RPC_URL`) first, each candidate proved to answer for the right chain before it is used.
- `createInjectedEvmRpc(page)` — adapts the active `window.ethereum` provider to the package's `EvmRpcRequester` port.
- `waitForEthTransactionMined(txHash, { requester | network | rpcUrl, ... })` — the EVM counterpart to `waitForTransactionMined`; an injected requester takes precedence over HTTP options.
- `EthTxReceiptStatus`, `StacksTxStatus` — what the two mined-polling helpers report.
- `EvmRpcRequester`, `EvmRpcRequestArguments` — the minimal EIP-1193 provider port receipt polling and contract reads are written against.
- `LaunchContextOptions`, `WalletAccount` — the option and result shapes of the above.
- `BrowserContext`, `Page` — re-exported Playwright types, so a driver need not import them separately.

## Full docs

See the [package-consumer README](https://github.com/yehia67/e2e-wallets#readme),
[quick-start tutorial](https://github.com/yehia67/e2e-wallets/blob/main/tutorials/quick-start.md), and
[reports and artifacts](https://github.com/yehia67/e2e-wallets/blob/main/tutorials/reports-and-artifacts.md)
for installation and complete application-owned examples.

[Core design notes](https://github.com/yehia67/e2e-wallets/blob/main/docs/core-design-notes.md) covers
the EVM RPC endpoint policy and ban-list, why this toolkit targets real testnet rather than a local
devnet, the architecture rules, and which artifacts Playwright owns versus this package.

[Reports and artifacts](https://github.com/yehia67/e2e-wallets/blob/main/tutorials/reports-and-artifacts.md) covers `createExtensionTest` and `withWalletReporting` in full: which artifact answers which question when a popup-driven test fails, the `video` / `screenshot` / `trace` modes and their precedence, and what to upload from CI.

## License

MIT
