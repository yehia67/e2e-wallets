# MetaMask EVM package example

This fixture proves the public `@wallets-e2e/core` and `@wallets-e2e/metamask` APIs against a minimal
dapp: wallet import, Sepolia selection, connection, ETH transfer, an arbitrary contract transaction,
ERC20 approval, and EIP-2612 permit. It is repository validation, not a consumer installation path.

Registry status verified 2026-08-30: published MetaMask `0.1.0` imports APIs missing from published
core `0.1.3`. Package consumers must wait for a compatible release rather than cloning, linking, or
copying toolkit source.

After a compatible pair is published, install it in your dapp and use a caller-owned unpacked
MetaMask path:

```bash
WALLETS_CORE_VERSION=replace-with-verified-version
WALLETS_METAMASK_VERSION=replace-with-verified-version
npm install --save-dev \
  "@wallets-e2e/core@${WALLETS_CORE_VERSION}" \
  "@wallets-e2e/metamask@${WALLETS_METAMASK_VERSION}" \
  @playwright/test
npx playwright install chromium
```

The default browser flow uses `createInjectedEvmRpc(page)` for contract reads and receipt polling, so
it follows MetaMask's active provider rather than independently selecting a public HTTP RPC.
`confirmTransaction` handles any normal smart-contract write; `approveTokenPermission` is only for
MetaMask's specialized ERC20 allowance screen, and `confirmSignature` handles typed data.

Use the [MetaMask package guide](../../wallets/metamask/README.md) and
[reporting tutorial](../../tutorials/reports-and-artifacts.md). Repository maintainers should use
[CONTRIBUTING.md](../../CONTRIBUTING.md) for internal workspace commands.
