# @wallets-e2e/leather

`WalletDriver` adapter for the real [Leather](https://leather.io) browser extension, built from source ([leather-io/extension](https://github.com/leather-io/extension)) — part of [wallets-e2e](https://github.com/yehia67/e2e-wallets), a toolkit for driving **real** Stacks wallet browser extensions in Playwright E2E tests. Real unlock, real popup approval, real signatures, real on-chain transactions. No mocking.

## Install

```bash
npm install --save-dev @wallets-e2e/core@0.1.3 @wallets-e2e/leather@0.1.3 @playwright/test
npx playwright install chromium
```

`@playwright/test` is a peer dependency — this package uses your project's own Playwright install.

The npm package supplies the driver. Chromium separately needs a real unpacked Leather extension.
Download a reviewed upstream commit archive and build it inside your dapp's gitignored
`.wallet-extensions` directory:

```bash
LEATHER_COMMIT=replace-with-reviewed-commit
mkdir -p .wallet-extensions
curl --fail --location \
  "https://github.com/leather-io/extension/archive/${LEATHER_COMMIT}.zip" \
  --output .wallet-extensions/leather.zip
unzip -q .wallet-extensions/leather.zip -d .wallet-extensions/leather-source
cd ".wallet-extensions/leather-source/extension-${LEATHER_COMMIT}"
pnpm install
pnpm prepare
pnpm build
cd -
mkdir -p .wallet-extensions/leather
cp -R ".wallet-extensions/leather-source/extension-${LEATHER_COMMIT}/dist" \
  .wallet-extensions/leather/dist
```

Set `LEATHER_EXTENSION_PATH=.wallet-extensions/leather/dist`, or use that path directly. Record the
reviewed commit; do not build a moving branch in CI.

## Quick example

```ts
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';

test('connects to my dapp', async () => {
  const context = await launchContext({
    extensionPath: process.env.LEATHER_EXTENSION_PATH ?? '.wallet-extensions/leather/dist',
    userDataDir: '',
    recordVideoDir: 'test-results/videos',
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000'); // your dapp, running locally

  await leatherDriver.importWallet(context, wallet.seedPhrase);
  await leatherDriver.switchToTestnetNetwork?.(context);

  await leatherDriver.connectToDapp(context, async () => {
    await page.getByRole('button', { name: 'Connect Wallet' }).click(); // your dapp's own button
    await selectWalletInStacksConnectModal(page, 'Leather');
  });

  await expect(page.getByTestId('connected-address')).toBeVisible();
  await context.close();
});
```

## What's exported

- `leatherDriver` — published `0.1.3` implements `importWallet`, `connectToDapp`,
  `confirmTransaction`, and `switchToTestnetNetwork`. A later compatible package release adds the
  typed `switchNetwork(context, network)` replacement.
- `./fixtures/wallet.js` — a fixture wallet for testing. Reads `WALLETS_E2E_SEED_PHRASE`/`WALLETS_E2E_MAINNET_ADDRESS`/`WALLETS_E2E_TESTNET_ADDRESS`/`WALLETS_E2E_PASSWORD` from the environment first, falling back to a safe, checked-in, no-value default.

## Full docs

See the [package-consumer quick start](https://github.com/yehia67/e2e-wallets/blob/main/tutorials/quick-start.md)
for signing, transferring, calling a contract, environment-backed fixtures, and receipt polling.

## License

MIT
