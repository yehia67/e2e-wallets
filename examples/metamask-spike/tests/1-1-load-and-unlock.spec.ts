import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchContext, resolveExtensionId } from '@wallets-e2e/core';
import { metamaskDriver } from '@wallets-e2e/metamask';
import { wallet } from '@wallets-e2e/metamask/fixtures/wallet.js';
import { test, expect } from './fixtures.js';

test('loads and unlocks the real MetaMask extension via import SRP', async ({ extensionContext }) => {
  const extensionId = await resolveExtensionId(extensionContext);
  expect(extensionId).toMatch(/^[a-z]{32}$/);

  const account = await metamaskDriver.importWallet(extensionContext, wallet.seedPhrase);
  expect(account.address.toLowerCase()).toBe(wallet.address.toLowerCase());
});

test('I/O matrix: missing extension build fails fast with a clear error, never silently skips', async () => {
  await expect(
    launchContext({
      extensionPath: join(import.meta.dirname, '../../../wallets/metamask/__does-not-exist__'),
      userDataDir: mkdtempSync(join(tmpdir(), 'wallets-e2e-metamask-missing-')),
      recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
    }),
  ).rejects.toThrow(/Extension not found/);
});

test('I/O matrix: empty seed fails fast instead of hanging until test timeout', async ({ extensionContext }) => {
  await expect(metamaskDriver.importWallet(extensionContext, '')).rejects.toThrow(/empty/i);
});
