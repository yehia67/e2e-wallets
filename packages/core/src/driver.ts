import type { BrowserContext, Page } from '@playwright/test';

/** An unlocked wallet account, as reported by a `WalletDriver` after import/unlock. */
export interface WalletAccount {
  address: string;
}

/**
 * The port every wallet adapter in this monorepo implements. Architecture rules:
 * docs/core-design-notes.md
 *
 * `TNetwork` is whatever value that wallet's chain uses to name a network. It defaults to `never`,
 * so a driver that declares no `switchNetwork` cannot be handed a network by accident.
 */
export interface WalletDriver<TNetwork = never> {
  importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount>;
  /** Points the wallet at a specific network before a chain-aware operation. */
  switchNetwork?(context: BrowserContext, network: TNetwork): Promise<void>;
  /** @deprecated Use `switchNetwork(context, network)`. Compatibility bridge for existing consumers. */
  switchToTestnetNetwork?(context: BrowserContext): Promise<void>;
  connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
  confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
  /** EIP-712 / typed-data signatures — distinct from on-chain transaction confirmations. */
  confirmSignature?(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
}

/**
 * Picks a wallet in `@stacks/connect`'s own in-page picker. Scoped to the row matching
 * `walletName` rather than the first "Connect" button, so it stays correct once more than one
 * wallet is installed.
 */
export async function selectWalletInStacksConnectModal(page: Page, walletName: string): Promise<void> {
  const row = page.locator('li', { hasText: walletName }).first();
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  await row.getByRole('button', { name: /^connect$/i }).click();
}

/** The blockchains this project has wallet drivers for. */
export type Chain = 'stacks' | 'evm';
