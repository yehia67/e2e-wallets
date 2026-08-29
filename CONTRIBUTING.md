# Contributing

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

`pnpm test` spends real testnet STX from the fixture wallet and waits on real blocks, so a full run is minutes, not seconds. To assert that the browser suites actually ran rather than skipped (what you want in CI), set `WALLETS_E2E_REQUIRE_EXTENSION=1` — a missing extension build then fails instead of skipping.

If those don't get you to a passing test suite on a clean checkout, that's a bug in this project (or its docs) — please open an issue.

## How the project is structured

Every wallet extension this project supports is driven the same way, through one shared contract:

- **`packages/core`** owns the parts that don't change per wallet: launching the browser with an extension loaded (`launchContext`), figuring out the extension's runtime ID (`resolveExtensionId`), and the `WalletDriver` interface every wallet adapter implements.
- **`wallets/<name>`** is one package per wallet. Each implements `WalletDriver`:
  ```ts
  interface WalletDriver {
    importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount>;
    connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
    confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
    confirmSignature?(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
  }
  ```
  `wallets/leather` is the reference implementation — read `wallets/leather/src/index.ts` before writing a new one. It's commented with exactly which parts were verified against the real extension's UI (button test-IDs, screen order, timing gotchas) versus which parts are structural. `wallets/metamask` is the second adapter (Ethereum / Sepolia via MetaMask's test build).
- **`examples/spike`** holds the actual Playwright tests that exercise a driver end to end. **`examples/react-connect`** is a real dapp with a real `@stacks/connect` integration, and **`examples/bdd`** drives that same dapp from Gherkin `.feature` files through the step library in `packages/core/src/bdd/`.

## Adding a new wallet adapter

1. Create `wallets/<name>/` as a new workspace package (copy `wallets/leather/`'s `package.json`/`tsconfig.json` shape as a starting point).
2. Figure out how to get an unpacked, source-built copy of the extension. If it's open source, prefer building from source over unpacking a Chrome Web Store `.crx` — reproducible, version-pinned, and auditable. Document exactly how in a `scripts/build-extension.sh` matching Leather's pattern.
3. Implement `importWallet` first, and get it passing against a real test before touching `connectToDapp`/`confirmTransaction`. **Inspect the real onboarding flow before automating it — don't guess at selectors, screen order, or validation rules (e.g., minimum password strength, exact word count).** A small standalone Node script that launches the extension headed and dumps page text/button labels at each step is the fastest way to do this; see the shape of the driver's own comments for the kind of thing worth writing down once you find it (e.g. "defaults to a 24-word seed screen," "Continue stays disabled below a password-strength threshold").
4. Write the equivalent of `examples/spike`'s test for the new wallet, covering at minimum: happy path, a missing-build error case, and a malformed-input error case that must fail loudly rather than silently reporting success.
5. Verify the address/account your driver returns against an independent derivation (e.g. via `@stacks/wallet-sdk`) rather than trusting that "the UI flow completed" means it actually worked.

### MetaMask (Sepolia) setup

MetaMask's fixture wallet has **no checked-in seed phrase** — you must generate one locally:

```bash
node wallets/metamask/scripts/generate-fixture-wallet.mjs   # prints a Sepolia funding address
# Fund that address on Sepolia (e.g. https://sepoliafaucet.com/) before send/deposit tests.
# Do NOT `source wallets/metamask/.env.local` — seed phrases contain spaces; tests load it via fixtures/wallet.ts.
pnpm build:metamask
cd examples/metamask-spike && forge build && cd ../../..      # ERC20 spike contracts
node examples/metamask-spike/scripts/deploy-sepolia.mjs       # deploy token + vault, mint WET
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
