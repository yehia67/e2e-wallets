# Gherkin and playwright-bdd

Use `playwright-bdd`, not `@cucumber/cucumber`. The latter has a separate runner/World and cannot
consume the Playwright fixtures that own the extension context.

This setup uses the core exports `createExtensionTest`, `withWalletReporting` and
`createWalletSteps`, all present from `0.1.4`. `playwright-bdd` is an optional peer of
`@wallets-e2e/core`; only the `@wallets-e2e/core/bdd` subpath requires it.

## Runner and fixture

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: './features/**/*.feature',
  steps: ['./steps/**/*.ts'],
});

export default withWalletReporting(defineConfig({ testDir, workers: 1 }));
```

```ts
// steps/fixtures.ts
import { createExtensionTest } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { leatherDriver } from '@wallets-e2e/leather';
import { resolve } from 'node:path';
import { test as bddTest } from 'playwright-bdd';

const extensionPath = resolve(
  process.env.LEATHER_EXTENSION_PATH ?? '.wallet-extensions/leather/dist',
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const test = createExtensionTest({
  base: bddTest,
  extensionPath,
  extensionName: 'Leather',
});

export const { Given, When, Then } = createWalletSteps({
  test,
  driver: leatherDriver,
  seedPhrase: required('WALLETS_E2E_SEED_PHRASE'),
  walletName: 'Leather',
  connectTestId: 'connect-wallet',
});
```

Own your test wallet rather than importing the package's fixture — see
[setup-and-reporting.md](setup-and-reporting.md#never-import-the-packages-own-wallet-fixtures).

The `base` must be `playwright-bdd`'s `test`. Include the fixture file in the `steps` glob so generated
specs import the extension-aware test. `createExtensionTest` overrides the stock `context` and `page`
fixtures consumed by step definitions.

Run generation and tests using the consuming application's scripts, commonly:

```bash
pnpm exec bddgen
pnpm exec playwright test
```

## Shared wallet steps

`createWalletSteps` registers:

- `Given I am connected to {chain} {network}`: parse, import, switch, navigate if blank, connect.
- `When I approve the wallet popup`: take the queued trigger and call `confirmTransaction`.
- `When I approve the wallet signature popup`: call `confirmSignature` when the driver supports it.
- `Then the transaction is mined`: Stacks receipt polling using the recorded txid/network.

The generic connection phrase is suited to Stacks (`Given I am connected to Stacks testnet`). EVM
projects typically define a network-valued MetaMask `Given` because it must resolve words such as
Sepolia into full `EvmNetwork` objects.

## Queue actions; do not click early

An action step that will be approved later must queue the dapp click:

```ts
import { queueWalletTrigger, recordTransactionId } from '@wallets-e2e/core/bdd';

When('I request a transfer', async ({ context, page }) => {
  queueWalletTrigger(context, async () => {
    await page.getByTestId('send').click();
  });
});

Then('a transaction id is shown', async ({ context, page }) => {
  const txid = (await page.getByTestId('txid').innerText()).trim();
  recordTransactionId(context, txid);
});
```

Do not click in the request step and then wait for approval in another step. The popup would open
before the driver registers its listener. Queued triggers are one-shot and detect accidental double
queueing.

## MetaMask-specific steps

ERC20 permission and EVM mining are intentionally dapp-specific:

```ts
When('I approve the token permission popup', async ({ context }) => {
  await metamaskDriver.approveTokenPermission(context, takeWalletTrigger(context));
});

Then('the EVM transaction is mined', async ({ page }) => {
  const requester = createInjectedEvmRpc(page);
  const txHash = extractHash(await page.getByTestId('status').innerText());
  expect(await waitForEthTransactionMined(txHash, { requester })).toBe('success');
});
```

Store per-scenario state in fixtures or context-associated state rather than unguarded module globals
when scenarios may run in parallel.

Live spending scenarios need a visible tag and an environment gate. Match the scenario's
`@timeout:` tag to the longest receipt poll. Keep address/network/connect scenarios non-spending so
they remain useful in ordinary CI.
