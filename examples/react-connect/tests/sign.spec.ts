import { leatherDriver } from '@wallets-e2e/leather';
import { test, expect } from './fixtures.js';

test.describe('Story 1.3: signing a message via the popup', () => {
  test('signs a message via the popup', async ({ connectedApp }) => {
    const { context, appPage } = connectedApp;

    await test.step('trigger a sign request and approve it in the real popup', async () => {
      // FR5-equivalent: trigger is the dapp-side action that requests a signature.
      await leatherDriver.confirmTransaction(context, async () => {
        await appPage.getByTestId('sign-message').click();
      });
    });

    await test.step('assert the real signature landed back on the dapp page', async () => {
      // Real end-to-end signal this driver's own scope can't see: the dapp page actually received
      // a signature back, not just that the popup closed.
      await expect(appPage.getByTestId('signature-result')).toBeVisible({ timeout: 10_000 });
      const text = await appPage.getByTestId('signature-result').innerText();
      expect(text).toMatch(/^Signature: .+/);
    });
  });

  test('I/O matrix: a sign trigger that never reaches the real popup throws, never resolves silently', async ({
    connectedApp,
  }) => {
    await expect(leatherDriver.confirmTransaction(connectedApp.context, async () => {})).rejects.toThrow();
  });
});
