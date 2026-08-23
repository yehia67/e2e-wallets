import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchContext, resolveExtensionId } from '@wallets-e2e/core';
import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
import { test, expect } from './fixtures.js';

test('Story 1.1: loads and unlocks the real Leather extension, video-recorded', async ({ extensionContext }) => {
  // FR1 / AD-4: extension ID resolved at runtime from the live service worker.
  const extensionId = await resolveExtensionId(extensionContext);
  expect(extensionId).toMatch(/^[a-z]{32}$/);

  // FR2 / NFR1 / AD-5: unlock via the checked-in, real-value-free fixture wallet.
  const account = await leatherDriver.importWallet(extensionContext, wallet.seedPhrase);
  expect(account.address).toBe(wallet.mainnetAddress);
});

test('I/O matrix: missing extension build fails fast with a clear error, never silently skips', async () => {
  // Deliberately targets a nonexistent extension path -- can't use the `extensionContext` fixture
  // (which skips the whole test when the extension isn't built), calls `launchContext` directly.
  await expect(
    launchContext({
      extensionPath: join(import.meta.dirname, '../../../wallets/leather/__does-not-exist__'),
      userDataDir: mkdtempSync(join(tmpdir(), 'wallets-e2e-spike-missing-')),
      recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
    }),
  ).rejects.toThrow(/Extension not found/);
});

test('I/O matrix: malformed fixture seed fails loudly instead of reporting a soft "unlocked: false"', async ({
  extensionContext,
}) => {
  // An empty seed phrase can never reach the set-password screen — importWallet must throw (via
  // the real navigation timing out) rather than resolve as if unlock succeeded.
  await expect(leatherDriver.importWallet(extensionContext, '')).rejects.toThrow();
});
