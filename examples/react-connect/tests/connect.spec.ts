import { leatherDriver } from '@wallets-e2e/leather';
import { wallet } from '@wallets-e2e/leather/fixtures/wallet.js';
import { test, expect } from './fixtures.js';

test.describe('Story 1.2: connecting a real dapp to Leather', () => {
  test('connects this app to a real, unlocked Leather wallet', async ({ connectedApp }) => {
    // The real, end-to-end signal this driver's own scope can't see itself (AD-8's fuller intent):
    // the dapp page actually received and rendered the connected address.
    const text = await connectedApp.appPage.getByTestId('connected-address').innerText();
    expect(text).toContain(wallet.mainnetAddress);
  });

  test('I/O matrix: a trigger that never reaches the real popup throws, never resolves silently', async ({
    unlockedContext,
  }) => {
    // A trigger that does nothing at all never causes a popup — connectToDapp must throw rather
    // than hang or resolve as if it worked.
    await expect(leatherDriver.connectToDapp(unlockedContext, async () => {})).rejects.toThrow();
  });
});
