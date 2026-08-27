# examples/bdd

Gherkin `.feature` files driving the **real** Leather extension, through the wallet steps shipped by [`@wallets-e2e/core/bdd`](../../packages/core/src/bdd/). The dapp under test is [`examples/react-connect`](../react-connect/) — there is no second demo app; this workspace starts that one's Vite dev server and points a browser at it.

## Running it

```bash
pnpm build:leather                          # from the repo root -- REQUIRED, see below
pnpm --filter @wallets-e2e/core build       # the ./bdd subpath is consumed from dist/
pnpm --filter @wallets-e2e/example-bdd test # bddgen && playwright test
```

Two scenarios run. The first connects a wallet and finishes in ~10 seconds. **The second sends a real STX transfer on real Stacks testnet** — it spends from the fixture wallet and waits for a real block, which can take ~10 minutes. It carries a `@timeout:1_200_000` tag for exactly that reason.

If `wallets/leather/dist/manifest.json` doesn't exist, both scenarios **skip** rather than fail — which is what you want locally and emphatically not what you want in CI. Set `WALLETS_E2E_REQUIRE_EXTENSION=1` to turn that skip into a failure:

```bash
WALLETS_E2E_REQUIRE_EXTENSION=1 pnpm --filter @wallets-e2e/example-bdd test
```

Requires Node >= 22.18, like the rest of the repo.

## How it fits together

| File | Role |
|---|---|
| `features/transfer.feature` | The readable artifact. Product language only — no seed phrase, no network switch, no extension path, no popup mechanics. |
| `steps/fixtures.ts` | Overrides Playwright's built-in `context`/`page` fixtures with an extension-loaded persistent context, then calls `createWalletSteps` to register the wallet steps and hand back the binders. |
| `steps/transfer.steps.ts` | The dapp-language steps — everything specific to react-connect's UI. |
| `playwright.config.ts` | `defineBddConfig` (features + steps globs) and a `webServer` that runs react-connect's `pnpm dev`. |

`bddgen` compiles `features/**/*.feature` into real Playwright specs under `.features-gen/` (gitignored) and the runner points at *that* directory, which is why the `test` script is `bddgen && playwright test` rather than `playwright test` alone.

## The one rule when you write your own steps

Every dapp-side click that opens a wallet popup must run **inside** the driver's `trigger()` callback. `connectToDapp` and `confirmTransaction` both register `context.waitForEvent('page')` *before* awaiting `trigger()`; a click performed outside it opens the popup with nobody listening and dies on a bare 10-second timeout that looks like a broken extension.

So a step that triggers a popup **queues** its action instead of performing it, and `When I approve the wallet popup` is what actually runs it:

```ts
When('I request a transfer of 1 STX', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('send-stx').click();
  });
});
```

Queueing twice without an approval in between throws, and approving with nothing queued throws — both with messages naming the fix. See `steps/transfer.steps.ts` for the full pattern, including handing a txid to `Then the transaction is mined` via `recordTransactionId`.
