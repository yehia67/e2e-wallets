import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run by `node --test` straight from source, excluded from the build.
import { launchContext } from './context.ts';

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
