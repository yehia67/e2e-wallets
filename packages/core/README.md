# @wallets-e2e/core

Shared machinery every wallet driver in the [wallets-e2e](https://github.com/yehia67/e2e-wallets) monorepo builds on — launches the real, extension-loaded Playwright browser context, resolves the extension's runtime ID, defines the `WalletDriver` interface every wallet adapter implements, and confirms transactions on-chain via RPC.

Part of a toolkit for driving **real** Stacks wallet browser extensions in Playwright E2E tests — real unlock, real popup approval, real signatures, real on-chain transactions. No mocking. [Leather](https://www.npmjs.com/package/@wallets-e2e/leather) is the first wallet adapter built on top of this package.

## Install

```bash
npm install --save-dev @wallets-e2e/core @playwright/test
```

`@playwright/test` is a peer dependency — this package uses your project's own Playwright install, not a bundled copy.

## What's exported

- `launchContext({ extensionPath, userDataDir, recordVideoDir, headless? })` — the one place a persistent Chromium context with a wallet extension loaded gets created.
- `resolveExtensionId(context)` — the extension's runtime ID, resolved from its live service worker (never a pre-pinned manifest key).
- `WalletDriver` — the interface every wallet adapter implements (`importWallet`, `connectToDapp`, `confirmTransaction`, optional `switchToTestnetNetwork`).
- `selectWalletInStacksConnectModal(page, walletName)` — picks a wallet in `@stacks/connect`'s own in-page wallet picker.
- `waitForTransactionMined(txid, options)` — polls a Stacks API until a transaction is confirmed, never trusting "the popup closed" as proof.
- `CHAIN`, `StacksNetwork`, `STACKS_NETWORK_RPC_URLS`, `TESTNET_RPC_URL` — the network constants this toolkit's RPC checks resolve against.

## Full docs

See the [monorepo README](https://github.com/yehia67/e2e-wallets#readme) and [quick-start tutorial](https://github.com/yehia67/e2e-wallets/blob/main/tutorials/quick-start.md) for a complete, real, working example.

## License

MIT
