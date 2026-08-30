# MetaMask BDD package example

This fixture demonstrates public `@wallets-e2e/core/bdd` and `@wallets-e2e/metamask` entrypoints for
connection, ordinary EVM transactions, ERC20 permission approval, EIP-712 signatures, and receipt
polling. It is repository validation, not a consumer installation path.

Registry status verified 2026-08-30: MetaMask `0.1.0` and core `0.1.3` are incompatible. Do not copy
a workspace dependency or source path into your dapp. Wait for a compatible public pair, verify the
required exports, then install it:

```bash
WALLETS_CORE_VERSION=replace-with-verified-version
WALLETS_METAMASK_VERSION=replace-with-verified-version
npm install --save-dev \
  "@wallets-e2e/core@${WALLETS_CORE_VERSION}" \
  "@wallets-e2e/metamask@${WALLETS_METAMASK_VERSION}" \
  @playwright/test playwright-bdd
npx playwright install chromium
```

Your project supplies the pinned unpacked MetaMask artifact, dapp server, selectors, deployed test
contracts, and environment-backed fixture wallet. Every dependent transaction must reach a
successful receipt before the next action starts.

Use the [package-consumer Gherkin tutorial](../../tutorials/feature-files.md) and
[MetaMask package guide](../../wallets/metamask/README.md). Repository maintainers should use
[CONTRIBUTING.md](../../CONTRIBUTING.md) for internal workspace commands.
