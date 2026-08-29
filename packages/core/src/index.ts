import { existsSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

/**
 * Options for launching the single, shared persistent browser context that every
 * wallet-driving test run is built on.
 *
 * AD-1: `packages/core` owns the single `chromium.launchPersistentContext` call —
 * no other package in this monorepo is allowed to call it directly.
 */
export interface LaunchContextOptions {
  /** Absolute path to the unpacked, built extension directory (its `manifest.json` parent). */
  extensionPath: string;
  /** Directory Chromium uses for its persistent profile. Defaults to a fresh temp dir if omitted. */
  userDataDir?: string;
  /** Directory Playwright should write the recorded video(s) into. Video recording is always on. */
  recordVideoDir: string;
  /** Runs headed unless explicitly overridden. v1 is scoped to headed execution (AD-6). */
  headless?: boolean;
}

/**
 * Launches the one persistent Chromium context every test in this monorepo runs against, with
 * the target extension pre-loaded and video recording enabled.
 *
 * Always uses `channel: 'chromium'` (Playwright's bundled Chromium) — never branded Chrome/Edge
 * (NFR2). Extensions only load via `launchPersistentContext`, never a one-off `chromium.launch`.
 */
export async function launchContext(options: LaunchContextOptions): Promise<BrowserContext> {
  const { extensionPath, userDataDir = '', recordVideoDir, headless = false } = options;

  if (!existsSync(extensionPath)) {
    throw new Error(
      `[packages/core] Extension not found at "${extensionPath}". ` +
        `Build it first (see wallets/leather/scripts/build-extension.sh) before launching a context.`,
    );
  }

  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      ...(headless ? ['--headless=new'] : []),
    ],
    recordVideo: { dir: recordVideoDir },
  });
}

/**
 * Resolves the extension's runtime ID from its live background service worker — never a
 * pre-pinned manifest key (AD-4), since the ID is only stable/known once Chromium has actually
 * loaded the unpacked extension for this run.
 */
export async function resolveExtensionId(context: BrowserContext): Promise<string> {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }

  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (!match) {
    throw new Error(
      `[packages/core] Could not resolve extension ID — unexpected service worker URL: "${worker.url()}"`,
    );
  }
  return match[1];
}

/** An unlocked wallet account, as reported by a `WalletDriver` after import/unlock. */
export interface WalletAccount {
  address: string;
}

/**
 * The port every wallet adapter in this monorepo implements (Ports & Adapters paradigm; AD-2).
 * Test code calls these methods directly and never touches raw `Page`/`BrowserContext` popup
 * logic itself — that's each adapter's job to encapsulate.
 *
 * Story 1.1 implements only `importWallet`. `connectToDapp`/`confirmTransaction` are typed stubs
 * here so Stories 1.2/1.3 implement against a stable, already-agreed contract.
 */
export interface WalletDriver {
  /** Imports a wallet from a seed phrase into the loaded, unlocked extension. */
  importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount>;
  /**
   * Story 1.4 — points the wallet at testnet before a chain-aware operation (a real transfer's
   * fee estimation, balance display) that a wallet's default network can't serve. Optional:
   * signing a plain message (Story 1.3) never needed this, and not every wallet's network-
   * selection UI may require an explicit driver step at all.
   */
  switchToTestnetNetwork?(context: BrowserContext): Promise<void>;
  /** Story 1.2 — approves a dApp connection request that opens in the extension's popup. */
  connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
  /** Story 1.3 — approves a transaction-signing request that opens in the extension's popup. */
  confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
  /** EIP-712 / typed-data signatures (e.g. ERC20 permit) — distinct from on-chain transaction confirmations. */
  confirmSignature?(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
}

/**
 * Selects a wallet by name in `@stacks/connect`'s own in-page "Connect a wallet" picker modal —
 * generic dapp-library UI, not any specific wallet's own screens, so it lives here rather than in
 * a wallet driver. Verified by direct inspection: the picker is plain DOM (no shadow root), each
 * installed/available wallet is a row containing its name and an exact-text "Connect" button;
 * uninstalled wallets show an "Install"/"Open" link instead, not a "Connect" button. Scoping the
 * click to the row matching `walletName` (not just "the first Connect button") keeps this correct
 * once more than one wallet is installed and listed as available.
 */
export async function selectWalletInStacksConnectModal(page: Page, walletName: string): Promise<void> {
  const row = page.locator('li', { hasText: walletName }).first();
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  await row.getByRole('button', { name: /^connect$/i }).click();
}

/**
 * The one blockchain this project targets today — kept as an explicit constant (not a bare
 * string literal scattered around) so a second chain, if this project ever grows to support one
 * (a wallet driver for a non-Stacks chain), has an obvious place to extend rather than requiring
 * a search-and-replace.
 */
export const CHAIN = 'stacks' as const;
export type Chain = typeof CHAIN;

/**
 * Every network Leather's own network picker offers for Stacks, verified by direct inspection of
 * its real UI (`settings-change-network` menu), mapped to the RPC host each one shows there. Only
 * `testnet4` is actually exercised by this project's own tests/scripts today — the rest are
 * listed for completeness and future use, not independently verified beyond what Leather's UI
 * displays for them.
 */
export type StacksNetwork = 'mainnet' | 'testnet4' | 'testnet3' | 'signet' | 'devnet';

export const STACKS_NETWORK_RPC_URLS: Record<StacksNetwork, string> = {
  mainnet: 'https://api.hiro.so',
  testnet4: 'https://api.testnet.hiro.so',
  testnet3: 'https://api.testnet.hiro.so',
  signet: 'https://api.testnet.hiro.so',
  devnet: 'http://localhost:3999',
};

/**
 * Default RPC endpoint for chain-facing checks: Hiro's public testnet Stacks API. Local Clarinet
 * devnet was tried first (Story 1.4) and dropped — two independent, real Clarinet 3.23.1 bugs
 * (a permanent chain stall a few minutes after every boot, and contract deploys that can't land
 * before that stall) made it unusable for this project's purposes. Callers can point
 * `waitForTransactionMined` at any other Stacks API-compatible RPC URL via its `rpcUrl` option —
 * this constant is only the default, not a hardcoded requirement.
 */
export const TESTNET_RPC_URL: string = STACKS_NETWORK_RPC_URLS.testnet4;

/**
 * Public Sepolia HTTPS RPCs — curl-verified (eth_chainId + eth_blockNumber + eth_gasPrice +
 * eth_getBalance), no API key, no Cloudflare/security interstitial.
 * Banned: Infura (dead test-build key), ethpandaops (browser security check), Tenderly public
 * (rate-limits eth_sendRawTransaction). Override with WALLETS_E2E_SEPOLIA_RPC_URL.
 */
export const SEPOLIA_RPC_URLS = [
  'https://0xrpc.io/sep',
  'https://eth-sepolia-testnet.api.pocket.network',
  'https://ethereum-sepolia-public.nodies.app',
  'https://sepolia.rpc.sentio.xyz',
  'https://ethereum-sepolia.gateway.tatum.io',
] as const;

/** Default Sepolia JSON-RPC endpoint for EVM transaction confirmation polling. */
export const SEPOLIA_RPC_URL: string =
  process.env.WALLETS_E2E_SEPOLIA_RPC_URL?.trim() || SEPOLIA_RPC_URLS[0];

/** Returns true when the endpoint is plain JSON-RPC Sepolia — rejects HTML/security walls. */
export async function probeSepoliaRpc(rpcUrl: string, timeoutMs = 12_000): Promise<boolean> {
  try {
    const host = new URL(rpcUrl).hostname.toLowerCase();
    // Known to pass Node fetch but fail MetaMask (Cloudflare / browser challenge).
    if (host.includes('ethpandaops.io')) return false;

    const post = async (method: string, params: unknown[]) => {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) return null;
      if (res.status >= 300 && res.status < 400) return null;
      if (!res.ok) return null;
      const text = await res.text();
      const lower = text.toLowerCase();
      if (
        text.trimStart().startsWith('<!') ||
        lower.includes('just a moment') ||
        lower.includes('cf-browser-verification') ||
        lower.includes('attention required') ||
        lower.includes('enable javascript') ||
        lower.includes('security check')
      ) {
        return null;
      }
      try {
        return JSON.parse(text) as { result?: string; error?: { message?: string } };
      } catch {
        return null;
      }
    };

    const chainBody = await post('eth_chainId', []);
    if (!chainBody?.result || chainBody.error?.message || chainBody.result !== '0xaa36a7') return false;

    const blockBody = await post('eth_blockNumber', []);
    if (!blockBody?.result) return false;
    const err = (blockBody.error?.message ?? '').toLowerCase();
    if (
      err.includes('free plan') ||
      err.includes('unauthorized') ||
      err.includes('api key') ||
      err.includes('rate limit') ||
      err.includes('too many requests')
    ) {
      return false;
    }

    const gasBody = await post('eth_gasPrice', []);
    return Boolean(gasBody?.result);
  } catch {
    return false;
  }
}

/** Ordered HTTPS candidates for MetaMask UI failover (env override first when set). */
export function sepoliaRpcCandidates(): string[] {
  const candidates = [
    process.env.WALLETS_E2E_SEPOLIA_RPC_URL?.trim(),
    ...SEPOLIA_RPC_URLS,
  ].filter((url): url is string => Boolean(url));
  return [...new Set(candidates)];
}

/** Pick the first reachable Sepolia RPC (env override wins when healthy). */
export async function resolveWorkingSepoliaRpc(): Promise<string> {
  const seen = new Set<string>();
  const tried: string[] = [];
  for (const url of sepoliaRpcCandidates()) {
    if (seen.has(url)) continue;
    seen.add(url);
    tried.push(url);
    if (await probeSepoliaRpc(url)) return url;
  }

  throw new Error(
    `[packages/core] No working Sepolia RPC found. Tried: ${tried.join(', ')}`,
  );
}

/** What `eth_getTransactionReceipt` reports once an EVM transaction is mined (or still pending). */
export type EthTxReceiptStatus = 'pending' | 'success' | 'reverted';

/**
 * Polls an Ethereum JSON-RPC endpoint by transaction hash until a receipt exists (or timeout).
 * Minimal EVM counterpart to `waitForTransactionMined` — never trust "the popup closed" alone.
 */
export async function waitForEthTransactionMined(
  txHash: string,
  options: { rpcUrl?: string; timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<EthTxReceiptStatus> {
  const { timeoutMs = 5 * 60_000, pollIntervalMs = 3_000 } = options;
  const rpcCandidates = options.rpcUrl
    ? [options.rpcUrl]
    : await (async () => {
        try {
          return [await resolveWorkingSepoliaRpc()];
        } catch {
          return [...SEPOLIA_RPC_URLS];
        }
      })();

  const deadline = Date.now() + timeoutMs;
  const normalizedHash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  let rpcIndex = 0;

  while (Date.now() < deadline) {
    const rpcUrl = rpcCandidates[rpcIndex] ?? SEPOLIA_RPC_URL;
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionReceipt',
          params: [normalizedHash],
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as {
        result?: { status?: string } | null;
        error?: { message?: string };
      };
      if (body.error) {
        throw new Error(body.error.message ?? 'unknown RPC error');
      }
      if (body.result) {
        const statusHex = body.result.status ?? '0x1';
        return statusHex === '0x1' ? 'success' : 'reverted';
      }
    } catch (error) {
      if (rpcIndex < rpcCandidates.length - 1) {
        rpcIndex += 1;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `[packages/core] Transaction ${normalizedHash} was not mined within ${timeoutMs}ms — ` +
      `the chain may be congested, or the transaction was never broadcast.`,
  );
}

/** What the Stacks API's `/extended/v1/tx/:txid` endpoint reports for a transaction's fate. */
export type StacksTxStatus =
  | 'pending'
  | 'success'
  | 'abort_by_response'
  | 'abort_by_post_condition'
  | 'not_found';

/**
 * Polls a Stacks API by transaction ID until it's mined (or definitively failed), never trusting
 * "the popup closed" as proof a transaction was actually broadcast (AD-8's port-level analogue
 * for on-chain confirmation, Story 1.4 / FR6). Real testnet block times are ~10 minutes — size
 * `timeoutMs` accordingly for testnet, much shorter for a local devnet.
 */
export async function waitForTransactionMined(
  txid: string,
  options: { rpcUrl?: string; timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<StacksTxStatus> {
  const { rpcUrl = TESTNET_RPC_URL, timeoutMs = 60_000, pollIntervalMs = 2_000 } = options;
  const deadline = Date.now() + timeoutMs;
  const normalizedTxid = txid.startsWith('0x') ? txid : `0x${txid}`;

  while (Date.now() < deadline) {
    const response = await fetch(`${rpcUrl}/extended/v1/tx/${normalizedTxid}`);
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `[packages/core] Stacks API at ${rpcUrl} returned ${response.status} for tx ${normalizedTxid} — ` +
          `is it reachable?`,
      );
    }
    const body = (await response.json()) as { tx_status: StacksTxStatus };
    if (body.tx_status === 'success' || body.tx_status.startsWith('abort_by')) {
      return body.tx_status;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `[packages/core] Transaction ${normalizedTxid} was not mined within ${timeoutMs}ms — ` +
      `the chain may be unhealthy, or the transaction was never actually broadcast.`,
  );
}

export type { BrowserContext, Page };
