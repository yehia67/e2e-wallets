# examples/metamask-bdd

Gherkin `.feature` files driving the **real** MetaMask extension on Sepolia, through wallet steps from [`@wallets-e2e/core/bdd`](../../packages/core/src/bdd/) plus MetaMask-specific steps in this folder. The dapp is [`examples/metamask-spike`](../metamask-spike/).

## Running

```bash
pnpm build:metamask
cd ../metamask-spike && forge build && cd ../metamask-bdd
node ../metamask-spike/scripts/deploy-sepolia.mjs   # ERC20 scenarios only
pnpm --filter @wallets-e2e/core build
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-metamask-bdd test
```

See [`wallets/metamask/README.md`](../../wallets/metamask/README.md) for fixture wallet rules (**keep your funded address — do not `generate --force`**).

## Features

| File | Scenarios |
|------|-----------|
| `features/metamask-sepolia.feature` | Connect, ERC20 deposit via `approve`, ERC20 deposit via EIP-2612 `permit` |

Wallet popup steps: `I approve the wallet popup`, `I approve the wallet signature popup` (from core/bdd).
