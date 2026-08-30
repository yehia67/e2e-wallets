# MetaMask EVM spike

Real MetaMask extension + minimal dapp: pick a network, connect, ETH send, ERC20 deposit (approve and EIP-2612 permit).

The network is a value the specs pass in (`EVM_NETWORKS.sepolia` — see `tests/0-network-switch.spec.ts`), not something baked into the driver. Sepolia is what this spike's contracts are deployed to.

## One-time setup

```bash
# 1. Generate fixture wallet (gitignored secrets) — **preserves existing .env.local** (same funded address)
node wallets/metamask/scripts/generate-fixture-wallet.mjs

# 2. Fund the printed address on Sepolia (ETH for gas)
#    https://sepoliafaucet.com/
#    Do NOT re-run generate with --force after funding (same address is preserved by default).

# 3. Download and verify the official pinned MetaMask 13.13.1 production extension
pnpm build:metamask

# 4. Compile spike contracts (Foundry + OpenZeppelin)
cd examples/metamask-spike && forge build && cd ../../..

# 5. Deploy TestToken + DepositVault to Sepolia (mints WET tokens to fixture wallet)
node examples/metamask-spike/scripts/deploy.mjs
```

## Run tests

```bash
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-metamask-spike test
```

Import, network, and connect tests are non-spending. ETH transfer and both ERC20 deposit paths are
opt-in because they spend live Sepolia gas:

```bash
WALLETS_E2E_REQUIRE_EXTENSION=1 WALLETS_E2E_RUN_SEPOLIA=1 \
  pnpm --filter @wallets-e2e/example-metamask-spike test
```

`deployed.json` and `public/deployed.json` are gitignored — regenerate after redeploy.

The default browser flow does not select a public HTTP RPC. Contract reads, permit nonces, and receipt polling use the active injected provider, so they follow the same connection MetaMask is using. HTTP candidates remain for deployment and explicit overrides (`WALLETS_E2E_RPC_URL_11155111` or `WALLETS_E2E_EVM_RPC_URL`).

For built-in Sepolia, `switchNetwork` selects MetaMask's existing network without editing its RPC. Custom networks and explicit overrides still use the validated add/update path. See [`wallets/metamask/README.md`](../../wallets/metamask/README.md#how-the-network-switch-works).

Just the network switch (the fastest way to see the driver work):

```bash
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-metamask-spike exec playwright test tests/0-network-switch.spec.ts
```
