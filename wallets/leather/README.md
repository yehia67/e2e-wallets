# @wallets-e2e/leather

`WalletDriver` adapter for the real [Leather](https://leather.io) browser extension, built from source ([leather-io/extension](https://github.com/leather-io/extension)) — part of [wallets-e2e](https://github.com/yehia67/e2e-wallets), a toolkit for driving **real** Stacks wallet browser extensions in Playwright E2E tests. Real unlock, real popup approval, real signatures, real on-chain transactions. No mocking.

## Install

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/leather @playwright/test
```

`@playwright/test` is a peer dependency — this package uses your project's own Playwright install.

Before running a test, the real extension must be built from source once (idempotent):

```bash
git clone --depth 1 https://github.com/leather-io/extension.git /tmp/leather-source
cd /tmp/leather-source && pnpm install && pnpm prepare && pnpm build
cp -R dist /path/to/your/project/wallets/leather/dist
```

## Quick example

```ts
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';

test('connects to my dapp', async () => {
  const context = await launchContext({
    extensionPath: 'wallets/leather/dist',
    userDataDir: '.tmp/leather-profile',
    recordVideoDir: 'test-results/videos',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your dapp, running locally

  await leatherDriver.importWallet(context, 'your twenty four word secret key');

  await leatherDriver.connectToDapp(context, async () => {
    await page.getByRole('button', { name: 'Connect Wallet' }).click(); // your dapp's own button
    await selectWalletInStacksConnectModal(page, 'Leather');
  });

  await expect(page.getByTestId('connected-address')).toBeVisible();
  await context.close();
});
```

## What's exported

- `leatherDriver` — implements `@wallets-e2e/core`'s `WalletDriver`: `importWallet`, `connectToDapp`, `confirmTransaction`, `switchToTestnetNetwork`.
- `./fixtures/wallet.js` — a fixture wallet for testing. Reads `WALLETS_E2E_SEED_PHRASE`/`WALLETS_E2E_MAINNET_ADDRESS`/`WALLETS_E2E_TESTNET_ADDRESS`/`WALLETS_E2E_PASSWORD` from the environment first, falling back to a safe, checked-in, no-value default.

## Full docs

See the [monorepo README](https://github.com/yehia67/e2e-wallets#readme) and [quick-start tutorial](https://github.com/yehia67/e2e-wallets/blob/main/tutorials/quick-start.md) for signing, transferring, calling a contract, and every real gotcha this toolkit's own test suite has hit.

## License

MIT
