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
 * `TNetwork` is whatever value that wallet's chain uses to name a network: a
 * `SupportedStacksNetwork` string for Leather, a full `EvmNetwork` value for MetaMask. It
 * defaults to `never`, so a driver that declares no `switchNetwork` needs no type argument and
 * cannot be handed a network by accident.
 */
export interface WalletDriver<TNetwork = never> {
  /** Imports a wallet from a seed phrase into the loaded, unlocked extension. */
  importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount>;
  /**
   * Points the wallet at a specific network before a chain-aware operation (a real transfer's
   * fee estimation, balance display) that the wallet's default network can't serve.
   *
   * The network is a *parameter*, not baked into the verb: a driver that only ever knew how to
   * reach "testnet" could never be told which testnet, which is exactly how the MetaMask driver
   * ended up hardcoded to one chain. Optional: signing a plain message never needed this, and not
   * every wallet's network-selection UI requires an explicit driver step at all.
   */
  switchNetwork?(context: BrowserContext, network: TNetwork): Promise<void>;
  /**
   * @deprecated Use `switchNetwork(context, network)`. Kept so existing Leather and early
   * MetaMask consumers can upgrade without changing every test in the same release.
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
 * The blockchains this project has wallet drivers for. No longer a single constant: the project
 * drives both a Stacks wallet (Leather) and an EVM wallet (MetaMask), so a `CHAIN` const naming
 * one of them would be a lie at every call site that meant the other.
 */
export type Chain = 'stacks' | 'evm';

/**
 * @deprecated The project now supports more than one chain. This remains the historical Stacks
 * default; new code should use the `Chain` type or an explicit chain literal.
 */
export const CHAIN = 'stacks' as const;

/**
 * Every network Leather's own network picker offers for Stacks, verified by direct inspection of
 * its real UI (`settings-change-network` menu), mapped to the RPC host each one shows there. Only
 * `testnet4` is actually exercised by this project's own tests/scripts today — the rest are
 * listed for completeness and future use, not independently verified beyond what Leather's UI
 * displays for them.
 */
export type StacksNetwork = 'mainnet' | 'testnet4' | 'testnet3' | 'signet' | 'devnet';

/**
 * The subset of `StacksNetwork` a `WalletDriver` can actually be placed on today — the value type
 * a Stacks driver's `switchNetwork` takes. Lives here, next to the port, rather than in `./bdd`:
 * `wallets/leather` needs it to type itself and must not have to depend on the optional
 * `playwright-bdd` peer just to name its own network type.
 */
export type SupportedStacksNetwork = Extract<StacksNetwork, 'mainnet' | 'testnet4'>;

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
 * One EVM network, as both a `WalletDriver` argument and an RPC target.
 *
 * This is the value that replaced this package's old single-chain constants. A driver takes one of
 * these and drives *that* network; nothing in driver logic gets to name a chain by string literal,
 * which is what pinned the MetaMask adapter to a single testnet in the first place.
 */
export interface EvmNetwork {
  /** Decimal EIP-155 chain id, e.g. `11155111`. The identity of the network. */
  chainId: number;
  /** The name the wallet shows for it. Used as the UI fallback selector and the label assertion. */
  name: string;
  /** Ordered RPC endpoints to try, best first. Probed for health before use — never trusted blind. */
  rpcUrls: readonly string[];
  /** Native currency symbol. EIP-3085 caps this at 6 characters — `wallet_addEthereumChain` rejects longer. */
  currencySymbol: string;
  /** Optional block explorer, for wallets whose add-network form asks for one. */
  blockExplorerUrl?: string;
  /**
   * True when a stock wallet install is expected to already ship this chain. **Documentation
   * only** — a driver must read "is it listed?" from the live UI, because a user profile can
   * already carry a chain the wallet does not ship, and trusting this flag would re-create the
   * add-vs-edit deadlock in reverse.
   */
  builtIn: boolean;
  /** True for test networks — wallets commonly hide these behind a "show test networks" toggle. */
  testnet: boolean;
}

/**
 * Presets for the EVM networks this project actually exercises. Preset *data*, not control flow:
 * driver code branches on `EvmNetwork` fields, never on which preset it was handed.
 *
 * These HTTP RPC candidates remain available for deployment scripts and explicit callers. Browser
 * tests should prefer `createInjectedEvmRpc(page)` so reads and receipts follow MetaMask's active
 * provider. The candidates are curl-verified across the full method set a wallet actually needs
 * (`eth_chainId`, `eth_blockNumber`, `eth_gasPrice`, `eth_getBalance`, `eth_getTransactionCount`,
 * `eth_getTransactionReceipt`, `eth_estimateGas`, `eth_feeHistory`), from a `chrome-extension://`
 * and a dapp origin, and under a 30-request burst — not just `eth_chainId`, which many gated
 * endpoints serve for free while paywalling everything else. `publicnode` leads because it is the
 * endpoint this repo's own contract deploys ran against.
 *
 * Banned from that list, each for an observed reason, not a guess:
 *   - credentialed Infura endpoints — unsuitable as generic package defaults.
 *   - `0xrpc.io/sep` — reported demanding credentials in real MetaMask runs. It answers every
 *     method over curl from a clean IP, so a probe cannot be relied on to catch it: keep it out.
 *   - `ethereum-sepolia.gateway.tatum.io` — hard cap of 5 requests/minute (HTTP 429 from the 6th).
 *   - `1rpc.io/sepolia` — serves chainId/blockNumber/gasPrice/getBalance, then answers
 *     `eth_estimateGas` with "chain is not available on free plan, please upgrade to paid plan".
 *     Intermittent (it returned 200 for the same call minutes earlier), which is exactly why a
 *     one-shot curl is not evidence and the probe covers the fee-estimation path.
 *   - `rpc.sepolia.org` (404), `sepolia.drpc.org` ("not available on free plan"),
 *     `endpoints.omniatech.io` (HTTP 521), ethpandaops (browser security check),
 *     Tenderly public (rate-limits `eth_sendRawTransaction`).
 *
 * Override any network's RPC with `WALLETS_E2E_RPC_URL_<chainId>`, or all of them with
 * `WALLETS_E2E_EVM_RPC_URL`.
 */
export const EVM_NETWORKS = {
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    rpcUrls: [
      // Used only for explicit overrides, custom-network operations, and non-browser callers.
      'https://eth-sepolia-testnet.api.pocket.network',
      'https://sepolia.rpc.sentio.xyz',
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://ethereum-sepolia-public.nodies.app',
    ],
    currencySymbol: 'SepoliaETH',
    blockExplorerUrl: 'https://sepolia.etherscan.io',
    builtIn: true,
    testnet: true,
  },
  /**
   * Base Sepolia is NOT one of the chains MetaMask ships (its default network list carries
   * `eip155:8453` for Base mainnet but no `84532`), which is exactly why it is here.
   *
   * Base Sepolia is added through the custom-network path and therefore requires one of these
   * probe-passing HTTP RPCs. Built-in Sepolia does not use this path by default.
   */
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrls: [
      'https://sepolia.base.org',
      'https://base-sepolia-rpc.publicnode.com',
      'https://base-sepolia.gateway.tenderly.co',
    ],
    currencySymbol: 'ETH',
    blockExplorerUrl: 'https://sepolia.basescan.org',
    builtIn: false,
    testnet: true,
  },
  mainnet: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrls: [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
    ],
    currencySymbol: 'ETH',
    blockExplorerUrl: 'https://etherscan.io',
    builtIn: true,
    testnet: false,
  },
  localhost: {
    chainId: 1337,
    name: 'Localhost 8545',
    rpcUrls: ['http://localhost:8545'],
    currencySymbol: 'ETH',
    builtIn: false,
    testnet: true,
  },
} as const satisfies Record<string, EvmNetwork>;

/** @deprecated Use `EVM_NETWORKS.sepolia.rpcUrls`. */
export const SEPOLIA_RPC_URLS = EVM_NETWORKS.sepolia.rpcUrls;

/**
 * @deprecated Use `resolveWorkingRpc(EVM_NETWORKS.sepolia)` when an HTTP endpoint is required.
 * Browser tests should prefer `createInjectedEvmRpc(page)` so reads use MetaMask's active RPC.
 */
export const SEPOLIA_RPC_URL: string =
  process.env.WALLETS_E2E_RPC_URL_11155111?.trim() ||
  process.env.WALLETS_E2E_EVM_RPC_URL?.trim() ||
  EVM_NETWORKS.sepolia.rpcUrls[0];

/**
 * Burn address, used only as a read target while probing. Any address works — it is never funded,
 * never signed for, and `eth_getBalance`/`eth_estimateGas` against it prove the endpoint answers
 * state and fee queries rather than only the free `eth_chainId`.
 */
const PROBE_ADDRESS = '0x0000000000000000000000000000000000000001';

/**
 * True when a JSON-RPC error message is the endpoint asking for money, a key, or a slower client,
 * rather than a genuine chain-level error. These arrive as HTTP 200 + an `error` body, so status
 * codes alone do not catch them.
 */
function isGatedRpcError(message: string | undefined): boolean {
  const err = (message ?? '').toLowerCase();
  if (!err) return false;
  return [
    'free plan',
    'unauthorized',
    'api key',
    'apikey',
    'credential',
    'authentication',
    'not authorized',
    'forbidden',
    'payment',
    'billing',
    'subscription',
    'upgrade to',
    'quota',
    'rate limit',
    'too many requests',
    'exceeded your limit',
  ].some((needle) => err.includes(needle));
}

function assertChainId(chainId: number, fn: string): void {
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new Error(
      `[packages/core] ${fn}: chain id must be a non-negative integer, got ${String(chainId)}.`,
    );
  }
}

/** `11155111` -> `'0xaa36a7'` — the form `eth_chainId` and older wallet testids use. */
export function chainIdToHex(chainId: number): string {
  assertChainId(chainId, 'chainIdToHex');
  return `0x${chainId.toString(16)}`;
}

/**
 * `11155111` -> `'eip155:11155111'` — the CAIP-2 form recent MetaMask builds use in network testids
 * from (`network-list-item-eip155:11155111`). The hex form is only a fallback for older builds.
 */
export function chainIdToCaip(chainId: number): string {
  assertChainId(chainId, 'chainIdToCaip');
  return `eip155:${chainId}`;
}

/**
 * Ordered RPC candidates for a network: the chain-specific env override first, then the
 * all-networks override, then the preset's own list. De-duplicated, order preserved.
 */
export function evmRpcCandidates(network: EvmNetwork): string[] {
  const candidates = [
    process.env[`WALLETS_E2E_RPC_URL_${network.chainId}`]?.trim(),
    process.env.WALLETS_E2E_EVM_RPC_URL?.trim(),
    ...network.rpcUrls,
  ].filter((url): url is string => Boolean(url));
  return [...new Set(candidates)];
}

/**
 * True when the endpoint is a plain JSON-RPC node actually serving `chainId` — rejects HTML,
 * redirects, auth/rate-limit walls, and nodes on a different chain.
 *
 * Never throws: the caller's whole job is to walk a candidate list, and an endpoint that blows up
 * is simply an endpoint that failed.
 */
export async function probeEvmRpc(rpcUrl: string, chainId: number, timeoutMs = 12_000): Promise<boolean> {
  try {
    const host = new URL(rpcUrl).hostname.toLowerCase();
    // Known to pass Node fetch but fail inside a wallet (Cloudflare / browser challenge).
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
      // 402/407 are the paywall/proxy-auth codes a "free" endpoint starts returning once it
      // decides you need credentials; 451 and 5xx mean it is not serving this chain to us either.
      if ([401, 402, 403, 407, 429, 451].includes(res.status)) return null;
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
    if (!chainBody?.result || chainBody.error?.message) return false;
    // Compare numerically, not as strings: nodes answer `0xaa36a7`, `0xAA36A7` and `0x0aa36a7`
    // interchangeably, and all three are the same chain.
    let reported: bigint;
    try {
      reported = BigInt(chainBody.result);
    } catch {
      return false;
    }
    if (reported !== BigInt(chainId)) return false;

    // Probe the methods a wallet actually needs to render a balance and estimate a fee — not just
    // the cheap read. Endpoints that serve `eth_chainId` free and paywall the rest are exactly the
    // failure this is here to catch ("this RPC request credential").
    const probes: Array<[string, unknown[]]> = [
      ['eth_blockNumber', []],
      ['eth_gasPrice', []],
      ['eth_getBalance', [PROBE_ADDRESS, 'latest']],
      ['eth_estimateGas', [{ to: PROBE_ADDRESS, value: '0x1' }]],
    ];
    for (const [method, params] of probes) {
      const body = await post(method, params);
      if (!body?.result) return false;
      if (isGatedRpcError(body.error?.message)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * The first candidate RPC that actually answers for this network (env override wins when
 * healthy). Throws listing every URL tried when none passes — a dead RPC must fail here, loudly,
 * rather than inside a wallet's UI as "unable to connect".
 */
export async function resolveWorkingRpc(network: EvmNetwork): Promise<string> {
  const tried: string[] = [];
  for (const url of evmRpcCandidates(network)) {
    tried.push(url);
    if (await probeEvmRpc(url, network.chainId)) return url;
  }

  throw new Error(
    `[packages/core] No working RPC found for ${network.name} (chain ${network.chainId}). ` +
      `Tried: ${tried.join(', ') || '(no candidates)'}`,
  );
}

/** What `eth_getTransactionReceipt` reports once an EVM transaction is mined (or still pending). */
export type EthTxReceiptStatus = 'pending' | 'success' | 'reverted';

/** The standard EIP-1193 request shape accepted by injected EVM providers. */
export interface EvmRpcRequestArguments {
  method: string;
  params?: readonly unknown[];
}

/** Minimal provider port used by receipt polling and contract-read helpers. */
export interface EvmRpcRequester {
  request(args: EvmRpcRequestArguments): Promise<unknown>;
}

/**
 * Bridges a Playwright page to its injected `window.ethereum` provider. Calls are executed in the
 * dapp, so they use the exact chain and RPC MetaMask selected instead of a second public endpoint.
 */
export function createInjectedEvmRpc(page: Page): EvmRpcRequester {
  return {
    async request(args: EvmRpcRequestArguments): Promise<unknown> {
      return page.evaluate(async (requestArgs) => {
        const provider = (window as unknown as {
          ethereum?: { request(value: EvmRpcRequestArguments): Promise<unknown> };
        }).ethereum;
        if (!provider) {
          throw new Error('[packages/core] No injected window.ethereum provider found on the page.');
        }
        return provider.request(requestArgs);
      }, args);
    },
  };
}

/**
 * Polls an Ethereum JSON-RPC endpoint by transaction hash until a receipt exists (or timeout).
 * Minimal EVM counterpart to `waitForTransactionMined` — never trust "the popup closed" alone.
 *
 * Pass `network` to have it resolve (and fail over between) that network's own healthy RPCs, or
 * `rpcUrl` to pin one endpoint. One of the two is required: there is no default chain to guess.
 */
export async function waitForEthTransactionMined(
  txHash: string,
  options: {
    requester?: EvmRpcRequester;
    network?: EvmNetwork;
    rpcUrl?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<EthTxReceiptStatus> {
  const { requester, network, timeoutMs = 5 * 60_000, pollIntervalMs = 3_000 } = options;
  if (!requester && !options.rpcUrl && !network) {
    throw new Error(
      `[packages/core] waitForEthTransactionMined needs an injected \`requester\`, a \`network\` ` +
        `(e.g. EVM_NETWORKS.sepolia), or an explicit \`rpcUrl\` — it will not guess a provider.`,
    );
  }

  const rpcCandidates = requester
    ? []
    : options.rpcUrl
    ? [options.rpcUrl]
    : await (async () => {
        // `network` is non-null here: the guard above rejects the case where neither was given.
        try {
          return [await resolveWorkingRpc(network!)];
        } catch {
          return evmRpcCandidates(network!);
        }
      })();

  if (!requester && rpcCandidates.length === 0) {
    throw new Error(
      `[packages/core] waitForEthTransactionMined: ${network?.name ?? 'the given network'} has no ` +
        `RPC candidates to poll — set WALLETS_E2E_RPC_URL_${network?.chainId ?? '<chainId>'} or ` +
        `pass an explicit rpcUrl.`,
    );
  }

  const deadline = Date.now() + timeoutMs;
  const normalizedHash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  let rpcIndex = 0;

  while (Date.now() < deadline) {
    try {
      let receipt: { status?: string } | null | undefined;
      if (requester) {
        receipt = (await requester.request({
          method: 'eth_getTransactionReceipt',
          params: [normalizedHash],
        })) as { status?: string } | null;
      } else {
        const rpcUrl = rpcCandidates[rpcIndex] ?? rpcCandidates[0];
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
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as {
          result?: { status?: string } | null;
          error?: { message?: string };
        };
        if (body.error) throw new Error(body.error.message ?? 'unknown RPC error');
        receipt = body.result;
      }
      if (receipt) {
        const statusHex = receipt.status ?? '0x1';
        return statusHex === '0x1' ? 'success' : 'reverted';
      }
    } catch (error) {
      if (!requester && rpcIndex < rpcCandidates.length - 1) {
        rpcIndex += 1;
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[packages/core] RPC failed while polling transaction ${normalizedHash}: ${message}`,
      );
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
