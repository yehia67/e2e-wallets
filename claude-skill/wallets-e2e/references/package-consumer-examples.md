# Package consumer examples

Use this reference when adding wallet E2E tests to a dapp that consumes `@wallets-e2e/*` from npm.
These examples require only installed packages and never import toolkit implementation files.
The dapp remains responsible for producing wallet requests; the package drives the real extension UI.

## Where the extension comes from

Chromium needs an unpacked extension directory whose root contains `manifest.json`.

For MetaMask, `@wallets-e2e/metamask` supplies it: the pinned 13.13.1 production build is fetched
into the package at install time, and on first use if an install skipped scripts. A consumer
project therefore holds no extension directory, no download script, and no extension path. For
Leather, or for a build of your own, keep the unpacked directory in a stable, gitignored place such
as `.wallet-extensions/leather/dist` and pass its absolute path to the core fixture. Never run
toolkit build scripts from a consumer project.

Use this ordinary application layout:

```text
my-dapp/
├── tests/
│   ├── fixtures.ts
│   └── wallet.spec.ts
├── .env.wallet-e2e.local     # wallet secrets; gitignored
├── playwright.config.ts
└── package.json
```

The seed phrase, matching address, and password must enter the test process through local or CI
secrets. Never embed a funded wallet in a spec, report, screenshot, or committed fixture.

## Verify registry compatibility before MetaMask installation

`core@0.1.7` with `metamask@0.2.0` is a verified compatible set; for Leather, `core@0.1.7` with
`leather@0.1.4`. Confirm the registry yourself rather than trusting
this note to stay current:

```bash
npm view @wallets-e2e/core version
npm view @wallets-e2e/metamask version dependencies
```

After installing candidate versions in a disposable or caller-approved project, verify the public
exports before writing tests:

```bash
node --input-type=module -e "const c=await import('@wallets-e2e/core'); for (const n of ['createExtensionTest','withWalletReporting','EVM_NETWORKS','createInjectedEvmRpc','waitForEthTransactionMined']) if (!(n in c)) throw new Error('missing core export: '+n); const m=await import('@wallets-e2e/metamask'); for (const n of ['metamaskDriver','createMetamaskTest','ensureMetamaskExtension']) if (!(n in m)) throw new Error('missing metamask export: '+n)"
```

Only after that check passes, install the verified pair using the application's package manager:

```bash
npm install --save-dev @playwright/test \
  @wallets-e2e/core@0.1.7 \
  @wallets-e2e/metamask@0.2.0
npx playwright install chromium
```

Pin exact versions rather than using `latest`, and run the export check above after any upgrade. If a
future pair fails that check, say so and stop — never present a source checkout as package usage.

## Prepare pinned MetaMask

Nothing to write. Installing `@wallets-e2e/metamask` downloads and verifies the pinned 13.13.1
production build. When an install blocks scripts — pnpm 10 by default, `npm --ignore-scripts`, an
offline CI — the first test run fetches it, or run it explicitly:

```bash
npx wallets-e2e-metamask
```

Under pnpm 10, `{ "pnpm": { "onlyBuiltDependencies": ["@wallets-e2e/metamask"] } }` lets the
install-time download run. `METAMASK_EXTENSION_PATH` overrides the packaged build with one of your
own, which is never downloaded over.

Never point a project at a moving `latest` release or at MetaMask CI test artifacts: they change
the UI without notice and previously shipped unusable Sepolia RPC credentials.

Provide the wallet through the environment:

```text
WALLETS_E2E_SEED_PHRASE=<local test-wallet phrase>
WALLETS_E2E_ETH_ADDRESS=<matching 0x address>
WALLETS_E2E_PASSWORD=<strong local extension password>
```

A gitignored `.env.wallet-e2e.local` (or `.env.wallet-e2e` / `.env.local`) next to the Playwright
config is loaded automatically, by the test process and by `@wallets-e2e/mcp` alike — so neither
`--env-file` nor a wrapper script is needed, and secrets stay out of `package.json` and MCP client
config. Real environment variables take precedence, which is how CI injects them.

The password protects only the local browser profile. The seed must belong to a dedicated test
wallet.

## MetaMask consumer configuration

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { withWalletReporting } from '@wallets-e2e/core';

export default withWalletReporting(
  defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    use: {
      baseURL: 'http://127.0.0.1:3000',
      channel: 'chromium',
    },
    webServer: {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
    },
  }),
);
```

```ts
// tests/fixtures.ts
import { createMetamaskTest } from '@wallets-e2e/metamask';

export const test = createMetamaskTest({
  profilePrefix: 'my-dapp-metamask',
  onMissingExtension: 'throw',
});

export { expect } from '@playwright/test';
```

`createMetamaskTest` is `createExtensionTest` with the packaged extension, its version name and its
prepare command already filled in; every other option is forwarded untouched. It fetches the build
if it is missing, then creates a fresh persistent profile, loads the extension, closes the context,
and attaches its videos to the test. A build it still cannot find fails the test with the command
to run.

## MetaMask connection and arbitrary contract transaction

This spec imports only published package entrypoints. Replace selectors with the consuming dapp's
real stable selectors:

```ts
// tests/wallet.spec.ts
import {
  EVM_NETWORKS,
  chainIdToHex,
  createInjectedEvmRpc,
  waitForEthTransactionMined,
} from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { test, expect } from './fixtures.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const seedPhrase = required('WALLETS_E2E_SEED_PHRASE');
const expectedAddress = required('WALLETS_E2E_ETH_ADDRESS');

test('connects MetaMask on Sepolia', async ({ extensionContext: context, page }) => {
  await page.goto('/');

  const account = await metamaskDriver.importWallet(context, seedPhrase);
  expect(account.address.toLowerCase()).toBe(expectedAddress.toLowerCase());

  await metamaskDriver.switchNetwork?.(context, EVM_NETWORKS.sepolia);
  await metamaskDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
  });

  await expect(page.getByTestId('connected-address')).toContainText(expectedAddress, {
    ignoreCase: true,
  });

  const rpc = createInjectedEvmRpc(page);
  expect(await rpc.request({ method: 'eth_chainId' })).toBe(
    chainIdToHex(EVM_NETWORKS.sepolia.chainId),
  );
});

test('submits any normal contract write', async ({ extensionContext: context, page }) => {
  test.skip(
    process.env.WALLETS_E2E_RUN_SEPOLIA !== '1',
    'Set WALLETS_E2E_RUN_SEPOLIA=1 to spend Sepolia gas.',
  );

  await page.goto('/');
  await metamaskDriver.importWallet(context, seedPhrase);
  await metamaskDriver.switchNetwork?.(context, EVM_NETWORKS.sepolia);
  await metamaskDriver.connectToDapp(context, async () => {
    await page.getByTestId('connect-wallet').click();
  });

  const rpc = createInjectedEvmRpc(page);
  const before = await page.getByTestId('contract-value').innerText();

  // The dapp may use viem, ethers, wagmi, or raw window.ethereum. The driver approves the UI.
  await metamaskDriver.confirmTransaction(context, async () => {
    await page.getByTestId('submit-contract-write').click();
  });

  const txHash = (await page.getByTestId('tx-hash').innerText()).trim();
  expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);
  expect(
    await waitForEthTransactionMined(txHash, {
      requester: rpc,
      timeoutMs: 8 * 60_000,
    }),
  ).toBe('success');

  await page.getByTestId('refresh-contract-value').click();
  await expect(page.getByTestId('contract-value')).not.toHaveText(before);
});
```

Use `approveTokenPermission` only for MetaMask's specialized ERC20 allowance screen and
`confirmSignature` for typed-data signatures. Mint, swap, stake, claim, vote, deploy, deposit,
withdraw, and other ordinary contract writes all use `confirmTransaction`.

## Leather package example

```bash
npm install --save-dev @playwright/test @wallets-e2e/core@0.1.4 @wallets-e2e/leather@0.1.4
npx playwright install chromium
```

`0.1.4` carries `createExtensionTest` and `withWalletReporting`, so prefer the fixture shown earlier
in this guide over the manual `launchContext` form below. The manual form remains valid and is the
right tool when you manage the context yourself.

Leather's JavaScript driver is installed from npm, while the real extension itself must be built
once. A non-Git source acquisition path is:

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

Pass `.wallet-extensions/leather/dist` as `LEATHER_EXTENSION_PATH`. Record the reviewed upstream
commit in the consuming project's dependency policy.

Provide `WALLETS_E2E_SEED_PHRASE`, its matching `WALLETS_E2E_MAINNET_ADDRESS` and
`WALLETS_E2E_TESTNET_ADDRESS`, and a strong `WALLETS_E2E_PASSWORD` before starting Playwright. The
published fixture validates the unlocked account against the mainnet-form address even when the test
later switches to testnet4.

The older package API uses `launchContext` directly:

```ts
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  launchContext,
  selectWalletInStacksConnectModal,
} from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';

test('connects Leather from npm', async ({}, testInfo) => {
  const context = await launchContext({
    extensionPath: resolve(
      process.env.LEATHER_EXTENSION_PATH ?? '.wallet-extensions/leather/dist',
    ),
    userDataDir: '',
    recordVideoDir: testInfo.outputPath('videos'),
  });

  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3000');
    await leatherDriver.importWallet(context, process.env.WALLETS_E2E_SEED_PHRASE ?? '');
    await leatherDriver.switchNetwork?.(context, 'testnet4');

    await leatherDriver.connectToDapp(context, async () => {
      await page.getByTestId('connect-wallet').click();
      await selectWalletInStacksConnectModal(page, 'Leather');
    });

    await expect(page.getByTestId('connected-address')).toBeVisible();
  } finally {
    await context.close();
  }
});
```

For the typed `switchNetwork`, automatic video attachment, failure screenshots, traces, and
`withWalletReporting`, use `0.1.4` or later with the same consumer
fixture/configuration pattern shown above.

## Run and open the report

With a compatible release that includes the reporting API:

```bash
npx playwright test
npx playwright show-report playwright-report
```

The report contains every test case. Package defaults retain videos and screenshots for successes
and failures and retain traces for unexpected failures. The primary `video` attachment prioritizes a
non-blank dapp or wallet recording.
