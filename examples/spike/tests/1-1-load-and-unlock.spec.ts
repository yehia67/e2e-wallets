import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchContext, resolveExtensionId } from '@stacks-wallet/core';
import { leatherDriver } from '@stacks-wallet/leather';
import { devnetWallet } from '@stacks-wallet/leather/fixtures/devnet-wallet.js';

const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

test('Story 1.1: loads and unlocks the real Leather extension, video-recorded', async () => {
  test.skip(
    !existsSync(join(EXTENSION_PATH, 'manifest.json')),
    `Leather is not built yet — run: bash wallets/leather/scripts/build-extension.sh`,
  );

  const userDataDir = mkdtempSync(join(tmpdir(), 'stacks-wallet-spike-'));
  const recordVideoDir = join(import.meta.dirname, '../test-results/videos');

  // FR1 / AD-1 / AD-4: single launchContext call, real extension loaded.
  const context = await launchContext({ extensionPath: EXTENSION_PATH, userDataDir, recordVideoDir });

  try {
    // FR1 / AD-4: extension ID resolved at runtime from the live service worker.
    const extensionId = await resolveExtensionId(context);
    expect(extensionId).toMatch(/^[a-z]{32}$/);

    // FR2 / NFR1 / AD-5: unlock via the checked-in, devnet-only fixture wallet.
    const account = await leatherDriver.importWallet(context, devnetWallet.seedPhrase);
    expect(account.address).toBe(devnetWallet.mainnetAddress);
  } finally {
    // FR7: video is written on context close regardless of pass/fail.
    await context.close();
  }
});

test('I/O matrix: missing extension build fails fast with a clear error, never silently skips', async () => {
  await expect(
    launchContext({
      extensionPath: join(import.meta.dirname, '../../../wallets/leather/__does-not-exist__'),
      userDataDir: mkdtempSync(join(tmpdir(), 'stacks-wallet-spike-missing-')),
      recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
    }),
  ).rejects.toThrow(/Extension not found/);
});

test('I/O matrix: malformed fixture seed fails loudly instead of reporting a soft "unlocked: false"', async () => {
  test.skip(
    !existsSync(join(EXTENSION_PATH, 'manifest.json')),
    `Leather is not built yet — run: bash wallets/leather/scripts/build-extension.sh`,
  );

  const userDataDir = mkdtempSync(join(tmpdir(), 'stacks-wallet-spike-badseed-'));
  const recordVideoDir = join(import.meta.dirname, '../test-results/videos');
  const context = await launchContext({ extensionPath: EXTENSION_PATH, userDataDir, recordVideoDir });

  try {
    // An empty seed phrase can never reach the set-password screen — importWallet must throw
    // (via the real navigation timing out) rather than resolve as if unlock succeeded.
    await expect(leatherDriver.importWallet(context, '')).rejects.toThrow();
  } finally {
    await context.close();
  }
});
