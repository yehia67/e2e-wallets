import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run by `node --test` straight from source, excluded from the build.
import { launchArgs, launchContext } from './context.ts';

describe('launchContext', () => {
  it('rejects with a build hint when the extension directory does not exist', async () => {
    await assert.rejects(
      () => launchContext({ extensionPath: '/definitely/not/a/real/extension' }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Extension not found/);
        assert.match(error.message, /packages\/core/);
        return true;
      },
    );
  });

  it('does not require recordVideoDir to reach the extension check', async () => {
    await assert.rejects(
      () => launchContext({ extensionPath: '/definitely/not/a/real/extension' }),
      /Extension not found/,
    );
  });
});

describe('launchArgs', () => {
  it('loads only the given extension and pins the device scale factor', () => {
    const args = launchArgs({ extensionPath: '/ext' });
    assert.ok(args.includes('--disable-extensions-except=/ext'));
    assert.ok(args.includes('--load-extension=/ext'));
    assert.ok(args.includes('--force-device-scale-factor=1'));
    assert.ok(!args.some((arg) => arg.startsWith('--headless')));
    assert.ok(!args.some((arg) => arg.startsWith('--window-size')));
  });

  it('uses the new headless mode when asked', () => {
    assert.ok(launchArgs({ extensionPath: '/ext', headless: true }).includes('--headless=new'));
  });

  it('sizes the window when asked', () => {
    assert.ok(launchArgs({ extensionPath: '/ext', windowSize: { width: 1280, height: 720 } })
      .includes('--window-size=1280,720'));
  });
});
