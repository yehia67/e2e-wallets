# `@wallets-e2e/core` design notes

Background for decisions in `packages/core` that the code itself can only point at. Everything here
was observed in real runs against real endpoints and real extensions — none of it is speculation,
and none of it should be re-litigated without new evidence of the same kind.

---

## EVM RPC endpoint policy

### Why the candidate lists look the way they do

`EVM_NETWORKS` in `packages/core/src/evm.ts` carries an ordered list of HTTP RPC endpoints per
network. These are preset *data*, never control flow: driver code branches on `EvmNetwork` fields,
never on which preset it was handed.

Browser tests should generally not use them at all. `createInjectedEvmRpc(page)` routes reads and
receipts through MetaMask's own active provider, so the test sees the exact chain and endpoint the
wallet selected rather than a second, independent public node that may disagree with it. The HTTP
candidates exist for deployment scripts, explicit callers, custom-network operations, and anything
running outside a browser.

For Sepolia, `publicnode` leads the practical ordering because it is the endpoint this repository's
own contract deploys actually ran against.

Base Sepolia is a special case worth knowing about: MetaMask does **not** ship it. Its default
network list carries `eip155:8453` for Base mainnet but no `84532`. Base Sepolia therefore has to be
added through the custom-network path, which means it genuinely needs a probe-passing HTTP RPC in a
way built-in Sepolia does not.

### Why the probe covers the full method set, not just `eth_chainId`

A large fraction of "free" public endpoints answer `eth_chainId` for anyone while paywalling
everything a wallet actually needs to render a balance or estimate a fee. A probe that checked only
`eth_chainId` would wave every one of them through, and the failure would then surface inside the
wallet's UI as an opaque "unable to connect" or a credential prompt mid-test.

So candidates are curl-verified across the full method set a wallet exercises:

```
eth_chainId        eth_blockNumber      eth_gasPrice        eth_getBalance
eth_estimateGas    eth_feeHistory       eth_getTransactionCount
eth_getTransactionReceipt
```

…from both a `chrome-extension://` origin and a dapp origin, and under a 30-request burst.

`probeEvmRpc` additionally rejects responses that are not really JSON-RPC: HTML bodies, redirects,
Cloudflare interstitials ("just a moment", "security check"), and the paywall status codes
`401, 402, 403, 407, 429, 451`. Gated endpoints commonly return **HTTP 200 with an `error` body**,
which is why `isGatedRpcError` matches on message text — free plan, api key, quota, rate limit, and
similar — rather than trusting the status code alone.

### The ban-list, with the observed reason for each

| Endpoint | Why it is excluded |
|---|---|
| credentialed Infura | unsuitable as a generic package default |
| `0xrpc.io/sep` | demanded credentials in real MetaMask runs while answering every method over curl from a clean IP — a probe cannot catch it, so it stays out permanently |
| `ethereum-sepolia.gateway.tatum.io` | hard cap of 5 requests/minute; HTTP 429 from the sixth |
| `1rpc.io/sepolia` | serves chainId/blockNumber/gasPrice/getBalance, then answers `eth_estimateGas` with "chain is not available on free plan, please upgrade to paid plan" — **intermittently**, having returned 200 for the same call minutes earlier |
| `rpc.sepolia.org` | HTTP 404 |
| `sepolia.drpc.org` | "not available on free plan" |
| `endpoints.omniatech.io` | HTTP 521 |
| ethpandaops | browser security check; passes Node fetch but fails inside a wallet, so it is rejected by hostname in `probeEvmRpc` |
| Tenderly public | rate-limits `eth_sendRawTransaction` |

The `1rpc.io` case is the important one: a one-shot curl is **not** evidence an endpoint is healthy,
which is exactly why the probe covers the fee-estimation path rather than a cheap read.

### Overrides

- `WALLETS_E2E_RPC_URL_<chainId>` — override one network, e.g. `WALLETS_E2E_RPC_URL_11155111`.
- `WALLETS_E2E_EVM_RPC_URL` — override every EVM network.

An override is tried first but still probed; a dead override fails loudly in `resolveWorkingRpc`
rather than inside a wallet's UI.

---

## Why real testnet, not a local Clarinet devnet

A local Clarinet devnet was tried first for the Stacks work and dropped. Two independent, real
Clarinet 3.23.1 bugs made it unusable:

1. A permanent chain stall a few minutes after every boot.
2. Contract deploys that could not land before that stall.

Real Stacks testnet is used instead, via Hiro's public API. Block times run around ten minutes —
size receipt timeouts and Playwright test timeouts accordingly. That is not a bug to work around;
it is the chain.

---

## Architecture rules

These are the invariants the package holds to. Code comments point here rather than restating them.

**AD-1 — one context factory.** `chromium.launchPersistentContext` is called in exactly one place in
this monorepo: `packages/core/src/context.ts`. A browser extension only loads through a persistent
context, never a one-off `chromium.launch`, and centralising it keeps the flags, channel and video
configuration honest. `createExtensionTest` builds on `launchContext`; it does not bypass it.

**AD-2 — ports and adapters.** `WalletDriver` is the port every wallet adapter implements. Test code
calls `importWallet` / `connectToDapp` / `confirmTransaction` and never touches raw popup `Page`
logic itself — that is each adapter's job to encapsulate.

**AD-4 — extension id from the live service worker.** `resolveExtensionId` reads the id from the
running background service worker, never from a pre-pinned manifest key. The id only exists once
Chromium has actually loaded the unpacked extension for that run, and it is regenerated each time.

**AD-5 — secrets from the environment.** Seed phrases, addresses and passwords come from
`WALLETS_E2E_*` variables. The one checked-in Leather seed is a deliberate zero-value fixture so the
suite runs out of the box; it has never held and will never hold anything of value.

**AD-6 — v1 is headed.** `headless` remains an opt-in passthrough. Extension UI behaves differently
headless, and the project's evidence model assumes a real rendered popup.

**NFR2 — bundled Chromium only.** Always `channel: 'chromium'`, never branded Chrome or Edge.

---

## Artifact division of labour

Established experimentally against Playwright 1.62.1, by reading its source and watching real runs.
For a context created by `chromium.launchPersistentContext`:

| Artifact | Owner | Detail |
|---|---|---|
| **Trace** | Playwright | Its instrumentation hooks *every* context creation. A manual `tracing.start()` collides with it — `"Tracing has been already started"`. |
| **Screenshot** | Playwright | Its recorder iterates every open page, so failures capture the dapp **and** the wallet's own `chrome-extension://` popup. |
| **Video** | this package | Playwright writes the `.webm` but never attaches or cleans it up for such a context — its video handling only serves `browser.newContext()`. |

So `createExtensionTest` owns video and nothing else. Left alone, the videos land as orphaned
`page@<hash>.webm` files in a shared directory, attributable to no test; the fixture names them per
test and attaches them, which is the entire reason the reporting module exists.

`artifacts` on `createExtensionTest` therefore takes `video` only. Trace and screenshots are
configured the ordinary Playwright way, through `use.trace` and `use.screenshot` — a project's `use`
beats an `.extend()`-supplied option default, so a per-fixture knob for those two would have been
silently ignored in the recommended setup.
