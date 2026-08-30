import { join } from 'node:path';
import { createExtensionTest } from '@wallets-e2e/core';

export const EXTENSION_PATH = join(import.meta.dirname, '../../../wallets/leather/dist');

export const test = createExtensionTest({
  extensionPath: EXTENSION_PATH,
  profilePrefix: 'wallets-e2e-spike',
  extensionName: 'Leather',
  buildCommand: 'bash wallets/leather/scripts/build-extension.sh',
  onMissingExtension: 'skip',
});

export { expect } from '@playwright/test';
