# MetaMask Sepolia spike

Real MetaMask extension + minimal dapp: connect, ETH send, ERC20 deposit (approve and EIP-2612 permit).

## One-time setup

```bash
# 1. Generate fixture wallet (gitignored secrets) — **preserves existing .env.local** (same funded address)
node wallets/metamask/scripts/generate-fixture-wallet.mjs

# 2. Fund the printed address on Sepolia (ETH for gas)
#    https://sepoliafaucet.com/
#    Do NOT re-run generate with --force after funding (same address is preserved by default).

# 3. Build MetaMask test extension
pnpm build:metamask

# 5. Compile spike contracts (Foundry + OpenZeppelin)
cd examples/metamask-spike && forge build && cd ../../..

# 6. Deploy TestToken + DepositVault to Sepolia (mints WET tokens to fixture wallet)
node examples/metamask-spike/scripts/deploy-sepolia.mjs
```

## Run tests

```bash
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-metamask-spike test
```

`deployed.sepolia.json` and `public/deployed.sepolia.json` are gitignored — regenerate after redeploy.

Sepolia RPC defaults to `https://0xrpc.io/sep` (probe-verified, no API key). The driver edits built-in Sepolia — it does not add a custom network. Override with `WALLETS_E2E_SEPOLIA_RPC_URL`.
