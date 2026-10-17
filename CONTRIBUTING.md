# Contributing

> **Maintainer-only documentation.** This is the sole document allowed to use repository workspace
> paths and internal build commands. User-facing READMEs, tutorials, skills, and examples must teach
> only published `@wallets-e2e/*` package entrypoints. If a compatible release does not exist, state
> that package consumption is blocked; never present a checkout, `workspace:*`, local link, or source
> import as consumer setup.

Before changing public documentation, validate examples against the files and exports in packed or
installed npm artifacts rather than against unpublished TypeScript source.

Thanks for considering it — this project is early and could genuinely use help, especially on wallet coverage.

## Getting set up

**Node 22.18 or newer is required.** `packages/core`'s unit tests are TypeScript files run straight from source by `node --test`, which relies on Node's unflagged type stripping — on Node 20 those tests fail with a syntax error before they run. Both manifests declare it via `engines`.

```bash
git clone https://github.com/yehia67/e2e-wallets.git
cd e2e-wallets
pnpm install
pnpm build:leather   # builds the real Leather extension from source (idempotent). REQUIRED for
                     # Leather browser suites — nothing in `pnpm build` does it, and without it
                     # those suites skip themselves rather than fail.
pnpm build:metamask  # downloads/builds the real MetaMask test extension (idempotent). REQUIRED for
                     # `examples/metamask-spike` — same skip-if-not-built pattern as Leather.
pnpm build
pnpm test            # `node --test` unit tests, then real Chromium windows driving the real
                     # extension -- expect browser popups, and a real testnet transaction
```

`pnpm test` spends real testnet funds from the fixture wallet and waits on real blocks, so a full run is minutes, not seconds. Nothing is skipped: a missing extension build or missing deployed contracts fails the run with the command to fix it.

If those don't get you to a passing test suite on a clean checkout, that's a bug in this project (or its docs) — please open an issue.

## Contributor workflow: verify recording

Install Playwright Chromium and an FFmpeg executable with the `libx264` and `libvpx` encoders. The
integration check packs core into a temporary application, imports its public package entrypoint,
and runs Chromium with a small MV3 extension. For `videoSource: 'chromium'` it decodes the attached
video to verify five app → wallet → app cycles, a reused wallet surface with iframe input, and
exclusion of invisible worker pages, plus separate/off modes, passing and failing retention and
missing-encoder fallback. For the default source it checks that the mp4 is attached as `video`,
that no frames leak, that failure-only retention encodes nothing for a pass, and — the case the
default exists for — that a frame recorded after an approval tab opened in the same window is the
full 1280×720 with no border (`cropdetect`).

```bash
pnpm --filter @wallets-e2e/core build
pnpm --filter @wallets-e2e/core typecheck
pnpm --filter @wallets-e2e/core test
pnpm --filter @wallets-e2e/metamask exec tsc --noEmit
node packages/core/scripts/check-recording.mjs
```

Set `KEEP_RECORDING_CHECK=1` to retain the temporary report and recordings for visual review.
This check verifies browser recording mechanics with a test extension; real MetaMask and Leather
approval suites remain the adapter verification workflows. Refresh generated agent guides with
`pnpm build:skill`.

## How the project is structured

Every wallet extension this project supports is driven the same way, through one shared contract:

- **`packages/core`** owns the parts that don't change per wallet: launching the browser with an extension loaded (`launchContext`), figuring out the extension's runtime ID (`resolveExtensionId`), and the `WalletDriver` interface every wallet adapter implements.
- **`wallets/<name>`** is one package per wallet. Each implements `WalletDriver`:
  ```ts
  interface WalletDriver<TNetwork = never> {
    importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount>;
    // The network is a parameter, not part of the verb — `TNetwork` is whatever value that chain
    // names a network with (a Stacks network word for Leather, an `EvmNetwork` for MetaMask).
    switchNetwork?(context: BrowserContext, network: TNetwork): Promise<void>;
    connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
    confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
    confirmSignature?(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
  }
  ```
  `wallets/leather` is the reference implementation — read `wallets/leather/src/index.ts` before writing a new one. It's commented with exactly which parts were verified against the real extension's UI (button test-IDs, screen order, timing gotchas) versus which parts are structural. `wallets/metamask` is the second adapter — the pinned official MetaMask 13.13.1 production extension, driving **any** EVM network: `switchNetwork(context, network)` keeps built-in providers intact and validates custom networks or explicit RPC overrides before adding them.
- **`examples/spike`** holds the actual Playwright tests that exercise a driver end to end. **`examples/react-connect`** is a real dapp with a real `@stacks/connect` integration, and **`examples/bdd`** drives that same dapp from Gherkin `.feature` files through the step library in `packages/core/src/bdd/`.
- **`packages/knowledge`** is the single source of truth for agent guides (`SKILL.md` + `references/`). `@wallets-e2e/mcp` serves them via `list_guides` / `get_guide`. `pnpm build:skill` copies them into `claude-skill/wallets-e2e/` and writes `claude-skill/wallets-e2e-skill-upload.zip` for Claude skill upload. Do not edit the generated copy.
- **`packages/mcp`** is the MCP server any agent uses to run a consuming project's Playwright suite and collect video / screenshot artifacts.
- **`packages/evidence`** turns a Playwright JSON report into a static evidence site (`wallets-e2e-evidence`); the MCP's `get_report` builds it with `evidence: true`. Zero dependencies, so the MCP can depend on it without pulling Playwright in.

## Publishing knowledge and MCP

### Contributor workflow: publish the screenshot-video release

This release uses core `0.2.0`, MetaMask `0.2.1`, evidence `0.1.0`, knowledge `0.1.9`, and MCP
`0.2.1` (Leather stays at `0.1.4`). Build and pack these versions before publication, checking that
the MetaMask tarball depends on core `^0.2.0` and the MCP tarball on knowledge `^0.1.9` and
evidence `^0.1.0`. Pack with pnpm so workspace dependencies become registry-compatible ranges. The
browser extension is not part of the package. Publish in dependency order: core, MetaMask,
evidence, knowledge, MCP.

`scripts/release.sh` runs every gate in order and stops at the first failure: toolchain, install,
build, typecheck, the packages' unit tests, the recording check, both extension builds
(`pnpm build:leather`, `pnpm build:metamask`), the fixture-wallet variables, then **every example
suite for real** — a suite with a skipped test, a flaky test or nothing executed fails the gate,
because a run that skipped proves nothing — then the skill build, pack and the tarball dependency
ranges. It spends testnet funds and takes a while. `scripts/release.sh --publish` then publishes
the tarballs in dependency order, skipping versions already on the registry; `--quick` runs only
typecheck and unit tests and refuses to publish; `--skip-gates` goes straight to pack, checks and
publish, for use right after a full run passed in the same checkout. By hand:

```bash
pnpm build
pnpm test
node packages/core/scripts/check-recording.mjs
pnpm build:skill

# Use a caller-selected temporary release directory and publish its inspected tarballs.
# `pnpm pack` takes no --filter; run it inside each package.
for pkg in core metamask evidence knowledge mcp; do
  pnpm --filter @wallets-e2e/$pkg exec pnpm pack --pack-destination /tmp/wallets-e2e-release
done

npm publish /tmp/wallets-e2e-release/wallets-e2e-core-0.2.0.tgz --access public
npm publish /tmp/wallets-e2e-release/wallets-e2e-metamask-0.2.1.tgz --access public
npm publish /tmp/wallets-e2e-release/wallets-e2e-evidence-0.1.0.tgz --access public
npm publish /tmp/wallets-e2e-release/wallets-e2e-knowledge-0.1.9.tgz --access public
npm publish /tmp/wallets-e2e-release/wallets-e2e-mcp-0.2.1.tgz --access public
```

What this release changes for consumers: the default video is an mp4 built from screenshots
(FFmpeg with `libx264` needed; `videoSource: 'chromium'` restores the WebM composition), a
`page-logs` attachment on failure, `metamaskDriver.confirmFollowUpPrompt`, the env loader no longer
overwrites a set-but-empty variable or sets `KEY=` lines, and core gains `createTxProbe`,
`settleWrite`, `assertSponsoredUserOperation` and the env helpers.

Publishing tarballs does not require Git mutations. After publication, check registry versions and
dependencies, install the mutually compatible releases in a consuming application, and restart
MCP clients so they load the new server instructions and knowledge guide. Upload the regenerated
Claude skill ZIP if using that integration. FFmpeg/libvpx must be available where tests run.

Publish **knowledge first**, then MCP. MCP depends on `@wallets-e2e/knowledge`; `pnpm publish` rewrites the workspace specifier to the version on disk. If knowledge is not on the registry yet, `npx @wallets-e2e/mcp` will fail to install.

```bash
pnpm --filter @wallets-e2e/knowledge build
pnpm --filter @wallets-e2e/knowledge test
pnpm --filter @wallets-e2e/knowledge publish --access public

pnpm --filter @wallets-e2e/mcp build
pnpm --filter @wallets-e2e/mcp test
pnpm --filter @wallets-e2e/mcp publish --access public
```

To run the MCP from this checkout while iterating (not a consumer install path):

```bash
pnpm --filter @wallets-e2e/knowledge build
pnpm --filter @wallets-e2e/mcp build
# client command: node, args: ["/absolute/path/to/packages/mcp/dist/index.js"]
pnpm --filter @wallets-e2e/mcp inspect
```

## Adding a new wallet adapter

1. Create `wallets/<name>/` as a new workspace package (copy `wallets/leather/`'s `package.json`/`tsconfig.json` shape as a starting point).
2. Figure out how to get an unpacked, source-built copy of the extension. If it's open source, prefer building from source over unpacking a Chrome Web Store `.crx` — reproducible, version-pinned, and auditable. Document exactly how in a `scripts/build-extension.sh` matching Leather's pattern.
3. Implement `importWallet` first, and get it passing against a real test before touching `connectToDapp`/`confirmTransaction`. **Inspect the real onboarding flow before automating it — don't guess at selectors, screen order, or validation rules (e.g., minimum password strength, exact word count).** A small standalone Node script that launches the extension headed and dumps page text/button labels at each step is the fastest way to do this; see the shape of the driver's own comments for the kind of thing worth writing down once you find it (e.g. "defaults to a 24-word seed screen," "Continue stays disabled below a password-strength threshold").
4. Write the equivalent of `examples/spike`'s test for the new wallet, covering at minimum: happy path, a missing-build error case, and a malformed-input error case that must fail loudly rather than silently reporting success.
5. Verify the address/account your driver returns against an independent derivation (e.g. via `@stacks/wallet-sdk`) rather than trusting that "the UI flow completed" means it actually worked.

### MetaMask (EVM) setup

MetaMask's fixture wallet has **no checked-in seed phrase** — you must generate one locally:

```bash
node wallets/metamask/scripts/generate-fixture-wallet.mjs   # prints a Sepolia funding address
# Fund that address on Sepolia (e.g. https://sepoliafaucet.com/) before send/deposit tests.
# Do NOT `source wallets/metamask/.env.local` — seed phrases contain spaces; tests load it via fixtures/wallet.ts.
pnpm build:metamask
cd examples/metamask-spike && forge build && cd ../../..      # ERC20 spike contracts
node examples/metamask-spike/scripts/deploy.mjs               # deploy token + vault, mint WET
pnpm --filter @wallets-e2e/example-metamask-spike test
```

The script writes `wallets/metamask/.env.local` (gitignored). Never commit seed phrases or that file.

## A few hard-won lessons worth knowing before you start

- **`page.waitForFunction(fn, options)` is a trap.** Playwright's real signature is `waitForFunction(fn, arg, options)` — passing an options object as the second argument silently puts it in the (usually unused) `arg` slot instead, and your timeout is quietly ignored. Always pass `waitForFunction(fn, undefined, options)` explicitly if you don't need `arg`.
- **Extensions require a headed browser in the common case**, and only load via `chromium.launchPersistentContext` with `channel: 'chromium'` (Playwright's bundled Chromium) — regular installed Chrome/Edge dropped the extension-loading flags in recent versions.
- **A UI flow "completing" isn't proof it worked.** Prefer reading back a real signal (persisted extension storage, an emitted event, an independently-derivable value) over trusting that a button click without an error means success.
- **Run the test, don't just write it.** Several real bugs in this project (wrong word count, a disabled button nobody noticed, the `waitForFunction` trap above) were only caught by actually running the automation against the real extension, not by review of the code.

## Pull requests

- Keep PRs scoped to one wallet or one concern — easier to review, easier to bisect if something breaks later when an extension updates upstream.
- Run `pnpm build && pnpm test` before opening a PR; CI (once set up) will run the same.
- If your change is because an extension's real UI changed upstream, say so in the PR description and link what changed if you can.
- Be upfront about anything you couldn't verify end-to-end (e.g. "wrote this against an older build, didn't re-verify against latest") — this project would rather know about a gap than have it discovered later by a flaky test.

## Reporting a broken driver

Wallet extensions change their UI without warning. If a driver that used to pass starts failing, please open an issue with:
- Which wallet and which driver method.
- The extension version (if you can find it — e.g. from its `manifest.json` after building).
- What actually happens now vs. what the driver expects (a screenshot or the recorded video from `test-results/videos/` helps a lot).
