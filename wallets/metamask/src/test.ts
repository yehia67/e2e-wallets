import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from '@playwright/test';
import { createExtensionTest, type CreateExtensionTestOptions, type ExtensionFixtures } from '@wallets-e2e/core';
import {
  ensureMetamaskExtension,
  metamaskExtensionPath,
  METAMASK_PREPARE_COMMAND,
  METAMASK_VERSION,
} from './extension.js';

type AnyTestArgs = PlaywrightTestArgs & PlaywrightTestOptions;
type AnyWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

export interface CreateMetamaskTestOptions<
  TBase extends TestType<AnyTestArgs, AnyWorkerArgs> = TestType<AnyTestArgs, AnyWorkerArgs>,
> extends Omit<CreateExtensionTestOptions<TBase>, 'extensionPath' | 'prepareExtension'> {
  /** An unpacked MetaMask build of your own. Defaults to the pinned one this package ships with. */
  extensionPath?: string;
}

/**
 * The Playwright `test` for MetaMask, with the extension already wired up: the packaged build is
 * located, and downloaded on first use if an install skipped its `postinstall`.
 *
 * Consumers therefore need no extension path, no download script and no `.wallet-extensions`
 * directory of their own — only their own artifact and profile preferences, which this forwards to
 * `createExtensionTest` untouched.
 */
export function createMetamaskTest<
  TArgs extends AnyTestArgs = AnyTestArgs,
  TWorkerArgs extends AnyWorkerArgs = AnyWorkerArgs,
>(
  options: CreateMetamaskTestOptions<TestType<TArgs, TWorkerArgs>> = {},
): TestType<TArgs & ExtensionFixtures, TWorkerArgs> {
  const extensionPath = options.extensionPath ?? metamaskExtensionPath();
  return createExtensionTest<TArgs, TWorkerArgs>({
    profilePrefix: 'wallets-e2e-metamask',
    extensionName: `MetaMask ${METAMASK_VERSION}`,
    buildCommand: METAMASK_PREPARE_COMMAND,
    ...options,
    extensionPath,
    prepareExtension: () => ensureMetamaskExtension(extensionPath),
  });
}
