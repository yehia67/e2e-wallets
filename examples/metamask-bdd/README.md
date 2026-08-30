# examples/metamask-bdd

Gherkin `.feature` files driving the **real** MetaMask extension on an EVM network, through wallet steps from [`@wallets-e2e/core/bdd`](../../packages/core/src/bdd/) plus MetaMask-specific steps in this folder. The dapp is [`examples/metamask-spike`](../metamask-spike/).

## Running

```bash
pnpm build:metamask
cd ../metamask-spike && forge build && cd ../metamask-bdd
node ../metamask-spike/scripts/deploy.mjs   # ERC20 scenarios only
pnpm --filter @wallets-e2e/core build
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-metamask-bdd test
```

This runs the non-spending connect scenario. Add `WALLETS_E2E_RUN_SEPOLIA=1` to include the tagged
ERC20 scenarios; they spend live Sepolia gas and token balances.

See [`wallets/metamask/README.md`](../../wallets/metamask/README.md) for fixture wallet rules (**keep your funded address — do not `generate --force`**).

## Features

| File | Scenarios |
|------|-----------|
| `features/metamask-evm.feature` | Connect, ERC20 deposit via `approve`, ERC20 deposit via EIP-2612 `permit` |

Wallet popup steps include the generic transaction/signature approvals from core/bdd plus the
MetaMask-specific `I approve the token permission popup`. Every dependent EVM operation waits for
the previous receipt through the injected provider.

`Given I am connected to MetaMask on <network>` names the network as data — the step resolves the word to an `EvmNetwork` and hands the whole value to `switchNetwork`. Add another network to `NETWORKS_BY_WORD` in `steps/metamask.steps.ts` and the same sentence drives it.
