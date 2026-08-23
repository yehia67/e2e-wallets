import { mkdtempSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@stacks-wallet/core';
import { leatherDriver } from '@stacks-wallet/leather';
import { devnetWallet } from '@stacks-wallet/leather/fixtures/devnet-wallet.js';

const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

test('Story 1.2: connects this app to a real, unlocked Leather wallet', async () => {
  test.skip(
    !existsSync(join(EXTENSION_PATH, 'manifest.json')),
    `Leather is not built yet — run: bash wallets/leather/scripts/build-extension.sh`,
  );

  const context = await launchContext({
    extensionPath: EXTENSION_PATH,
    userDataDir: mkdtempSync(join(tmpdir(), 'react-connect-spike-')),
    recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
  });

  try {
    // Reuse Story 1.1's exact, already-proven unlock flow.
    await leatherDriver.importWallet(context, devnetWallet.seedPhrase);

    const appPage = await context.newPage();
    await appPage.goto('/');

    // FR3-equivalent: trigger is entirely this test's responsibility (AD-2) — click this app's own
    // Connect Wallet button, then pick Leather in @stacks/connect's generic wallet picker.
    await leatherDriver.connectToDapp(context, async () => {
      await appPage.getByTestId('connect-wallet').click();
      await selectWalletInStacksConnectModal(appPage, 'Leather');
    });

    // The real, end-to-end signal this driver's own scope can't see itself (AD-8's fuller intent):
    // the dapp page actually received and rendered the connected address.
    await expect(appPage.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });
    const text = await appPage.getByTestId('connected-address').innerText();
    expect(text).toContain(devnetWallet.mainnetAddress);
  } finally {
    await context.close();
  }
});

test('I/O matrix: a trigger that never reaches the real popup throws, never resolves silently', async () => {
  test.skip(
    !existsSync(join(EXTENSION_PATH, 'manifest.json')),
    `Leather is not built yet — run: bash wallets/leather/scripts/build-extension.sh`,
  );

  const context = await launchContext({
    extensionPath: EXTENSION_PATH,
    userDataDir: mkdtempSync(join(tmpdir(), 'react-connect-spike-badtrigger-')),
    recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
  });

  try {
    await leatherDriver.importWallet(context, devnetWallet.seedPhrase);
    const appPage = await context.newPage();
    await appPage.goto('/');

    // A trigger that does nothing at all never causes a popup — connectToDapp must throw rather
    // than hang or resolve as if it worked.
    await expect(leatherDriver.connectToDapp(context, async () => {})).rejects.toThrow();
  } finally {
    await context.close();
  }
});
