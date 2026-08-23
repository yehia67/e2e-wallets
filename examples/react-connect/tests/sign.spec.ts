import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchContext, selectWalletInStacksConnectModal } from '@stacks-wallet/core';
import { leatherDriver } from '@stacks-wallet/leather';
import { devnetWallet } from '@stacks-wallet/leather/fixtures/devnet-wallet.js';

const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

async function connectFirst(context: Awaited<ReturnType<typeof launchContext>>, appPage: import('@playwright/test').Page) {
  await leatherDriver.importWallet(context, devnetWallet.seedPhrase);
  await appPage.goto('/');
  await leatherDriver.connectToDapp(context, async () => {
    await appPage.getByTestId('connect-wallet').click();
    await selectWalletInStacksConnectModal(appPage, 'Leather');
  });
  await expect(appPage.getByTestId('connected-address')).toBeVisible({ timeout: 10_000 });
}

test('Story 1.3: signs a message via the popup', async () => {
  test.skip(
    !existsSync(join(EXTENSION_PATH, 'manifest.json')),
    `Leather is not built yet — run: bash wallets/leather/scripts/build-extension.sh`,
  );

  const context = await launchContext({
    extensionPath: EXTENSION_PATH,
    userDataDir: mkdtempSync(join(tmpdir(), 'react-connect-sign-')),
    recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
  });

  try {
    const appPage = await context.newPage();
    await connectFirst(context, appPage);

    // FR5-equivalent: trigger is the dapp-side action that requests a signature.
    await leatherDriver.confirmTransaction(context, async () => {
      await appPage.getByTestId('sign-message').click();
    });

    // Real end-to-end signal this driver's own scope can't see (same pattern as Story 1.2): the
    // dapp page actually received a signature back.
    await expect(appPage.getByTestId('signature-result')).toBeVisible({ timeout: 10_000 });
    const text = await appPage.getByTestId('signature-result').innerText();
    expect(text).toMatch(/^Signature: .+/);
  } finally {
    await context.close();
  }
});

test('I/O matrix: a sign trigger that never reaches the real popup throws, never resolves silently', async () => {
  test.skip(
    !existsSync(join(EXTENSION_PATH, 'manifest.json')),
    `Leather is not built yet — run: bash wallets/leather/scripts/build-extension.sh`,
  );

  const context = await launchContext({
    extensionPath: EXTENSION_PATH,
    userDataDir: mkdtempSync(join(tmpdir(), 'react-connect-sign-badtrigger-')),
    recordVideoDir: join(import.meta.dirname, '../test-results/videos'),
  });

  try {
    const appPage = await context.newPage();
    await connectFirst(context, appPage);

    await expect(leatherDriver.confirmTransaction(context, async () => {})).rejects.toThrow();
  } finally {
    await context.close();
  }
});
