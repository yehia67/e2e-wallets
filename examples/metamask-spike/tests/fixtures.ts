import { join } from 'node:path';
import { createExtensionTest } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/metamask/dist');

export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-metamask-spike',
  extensionName: 'MetaMask',
  buildCommand: 'npx wallets-e2e-metamask',
});

export { expect } from '@playwright/test';
