---
name: wallets-e2e
description: "Test dapps with real MetaMask or Leather in Playwright: wallet import, networks, smart-contract transactions, signatures, receipt polling, BDD, debugging, and HTML/video/screenshot reports."
---

# Wallet dapp E2E testing

Use `@wallets-e2e/core` with the appropriate wallet driver to exercise the real browser extension and
the real dapp. Preserve the consuming project's framework, package manager, selectors, server
command, and test conventions; this skill supplies the wallet lifecycle and evidence model.

## Get the packages first

- Project home and issues: [github.com/yehia67/e2e-wallets](https://github.com/yehia67/e2e-wallets)
- Core package: [npmjs.com/package/@wallets-e2e/core](https://www.npmjs.com/package/@wallets-e2e/core)
- MetaMask package: [npmjs.com/package/@wallets-e2e/metamask](https://www.npmjs.com/package/@wallets-e2e/metamask)
- Leather package: [npmjs.com/package/@wallets-e2e/leather](https://www.npmjs.com/package/@wallets-e2e/leather)

Read [references/setup-and-reporting.md](references/setup-and-reporting.md) before installing. It
contains exact package paths plus a compatibility warning: on 2026-08-30 the published MetaMask/core
versions are mismatched, and the new fixture/reporting APIs described by this skill are not yet in
published core 0.1.3. Treat npm MetaMask usage as blocked until registry versions are compatible;
never substitute repository source for the public package. Recheck registry metadata rather than
assuming this dated status remains true.

For a normal consuming application, start with
[references/package-consumer-examples.md](references/package-consumer-examples.md). Its examples use
only public `@wallets-e2e/*` imports and a caller-owned unpacked extension path. Do not make package
users copy implementation files or adapt repository fixtures as an installation method.

## Route the task

Read only the references needed for the requested work:

- For fixture setup, Playwright configuration, videos, screenshots, traces, HTML reports, CI uploads,
  and artifact review, read [references/setup-and-reporting.md](references/setup-and-reporting.md).
- For copy-ready npm/pnpm installation and tests in an application that consumes the packages, read
  [references/package-consumer-examples.md](references/package-consumer-examples.md).
- For MetaMask, EVM networks, Sepolia, ETH, arbitrary contract interactions, ERC20 approval,
  EIP-712/EIP-2612 signatures, deposits, custom RPCs, and injected-provider receipt polling, read
  [references/metamask-evm.md](references/metamask-evm.md).
- For Leather, Stacks networks, message signing, STX transfers, contract calls, and Stacks receipt
  polling, read [references/leather-stacks.md](references/leather-stacks.md).
- For `.feature` files and `playwright-bdd`, read [references/bdd.md](references/bdd.md).
- When a popup, connection, RPC, artifact, or timeout behaves unexpectedly, read
  [references/troubleshooting.md](references/troubleshooting.md).

## Agent workflow

1. Inspect the repository before editing. Find the Playwright config, fixtures, dapp server command,
   wallet package, extension build path, test selectors, environment-variable convention, and existing
   focused tests. Reuse them rather than creating a parallel harness.
   If the package is absent, install a verified compatible public release. If none exists, report
   that blocker instead of cloning or linking toolkit source.
2. Identify the chain and wallet explicitly: MetaMask takes an `EvmNetwork`; Leather takes a
   supported Stacks network. Do not infer a live network from an RPC URL or dapp label.
3. Separate non-spending smoke coverage from live-chain spending coverage. Import, network, and
   connect tests should run without spending. Gate transfers and contract writes behind the
   repository's explicit opt-in environment variable.
4. Implement the smallest complete user journey. A reliable wallet flow is:

   `import → navigate dapp → select network → connect → trigger wallet action → approve/sign → wait for receipt → assert dapp and chain state`

5. Run focused tests first, then broader unit/build/type checks. Do not report success for a command
   that was skipped, not run, or intentionally failed. An intentional failure is valid only for
   proving failure artifacts and must be labelled as such.
6. Generate review evidence when requested: preserve the HTML report, videos, screenshots, traces,
   and a short result summary with exact paths. Visually inspect relevant frames/screenshots; file
   existence alone does not prove that a wallet or dapp was recorded.

## Non-negotiable invariants

- Use `createExtensionTest` for the extension-loaded persistent context and cleanup. Use
  `withWalletReporting` for the list plus unfiltered HTML reporters and artifact defaults.
- Put every dapp-side action that opens a wallet window inside the driver method's `trigger`
  callback. The driver begins listening before invoking the callback. Clicking earlier creates the
  classic “popup appeared but the test timed out” race.
- Import once per fresh profile and switch the wallet to the intended network before connecting or
  submitting a chain-aware action.
- Use the action matching the wallet screen, not the contract name: `connectToDapp` for connection;
  `confirmTransaction` for any standard on-chain transaction/contract write; MetaMask
  `approveTokenPermission` only for its specialized ERC20 allowance screen; and `confirmSignature`
  for EIP-712/EIP-2612 signatures. Contract reads require no wallet confirmation.
- Never treat popup closure, a dapp hash, or a pending receipt as success. Wait for mining, fail on a
  reverted/aborted result, then assert a meaningful state change. Wait for every dependent
  transaction before starting the next operation.
- For browser EVM reads and receipts, prefer `createInjectedEvmRpc(page)` so the test uses the exact
  provider and network active in MetaMask. HTTP RPC resolution is for deployment scripts or callers
  that explicitly require it.
- Never log, embed, commit, attach, or publish a valuable seed phrase/private key. Use a dedicated
  throwaway fixture wallet loaded from local environment variables. Treat videos, screenshots, and
  traces as sensitive because onboarding may record secret entry.
- Live-chain tests consume gas and tokens. Do not fund, deploy, transfer, approve, or deposit without
  the user's scope or the repository's explicit opt-in gate.
- Keep tests observable: assert the imported address, active chain, connected address, transaction
  hash shape, mined status, and balance/state delta appropriate to the flow.
- Do not run Git write operations on the user's behalf. Leave staging, commits, branches, merges,
  rebases, resets, stashes, tags, cleaning, and pushes to the user; use read-only Git inspection only.
- All user-facing setup and code examples must consume public package entrypoints. Repository source,
  workspace dependencies, internal scripts, and monorepo example paths are contributor concerns and
  must not be presented as a user installation path.

## Completion standard

A wallet E2E change is complete only when the requested behavior is implemented, focused tests have
actually run, dependent type/build checks pass, and the retained evidence answers what happened in
the dapp and wallet. Report the exact pass/fail/skip counts, identify any spending tests not run, and
link the generated HTML report and useful artifacts.
