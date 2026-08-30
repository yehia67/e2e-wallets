import { join } from 'node:path';
import { expect } from '@playwright/test';
import { createExtensionTest } from '@wallets-e2e/core';
import { createWalletSteps } from '@wallets-e2e/core/bdd';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
// `base` must be playwright-bdd's `test`: `createBdd()` rejects any test that doesn't carry its fixtures.
import { test as bddTest } from 'playwright-bdd';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

// The built-in `context`/`page` are overridden here because the bdd steps read those stock names.
export const test = createExtensionTest({
  base: bddTest,
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-bdd',
  extensionName: 'Leather',
  buildCommand: 'pnpm build:leather',
});

export const { Given, When, Then } = createWalletSteps({
  test,
  driver: leatherDriver,
  seedPhrase: wallet.seedPhrase,
  walletName: 'Leather',
  connectTestId: 'connect-wallet',
});

export { expect };
