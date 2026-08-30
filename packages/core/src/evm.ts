import type { Page } from '@playwright/test';

/** One EVM network, as both a `WalletDriver` argument and an RPC target. */
export interface EvmNetwork {
  /** Decimal EIP-155 chain id, e.g. `11155111`. */
  chainId: number;
  /** The name the wallet shows for it. Used as the UI fallback selector and the label assertion. */
  name: string;
  /** Ordered RPC endpoints to try, best first. Probed for health before use — never trusted blind. */
  rpcUrls: readonly string[];
  /** Native currency symbol. EIP-3085 caps this at 6 characters. */
  currencySymbol: string;
  /** Optional block explorer, for wallets whose add-network form asks for one. */
  blockExplorerUrl?: string;
  /**
   * True when a stock wallet install is expected to already ship this chain. Documentation only —
   * a driver must read "is it listed?" from the live UI, since a profile can already carry a chain
   * the wallet does not ship.
   */
  builtIn: boolean;
  /** True for test networks — wallets commonly hide these behind a "show test networks" toggle. */
  testnet: boolean;
}

/**
 * Presets for the EVM networks this project exercises. Preset *data*, not control flow: driver
 * code branches on `EvmNetwork` fields, never on which preset it was handed.
 *
 * These HTTP candidates serve deployment scripts and explicit callers; browser tests should prefer
 * `createInjectedEvmRpc(page)`. Endpoint choices, the ban-list rationale and the env overrides:
 * docs/core-design-notes.md
 */
export const EVM_NETWORKS = {
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    rpcUrls: [
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
  /** Not shipped by MetaMask (no `84532` in its default list), so it goes through the custom-network path. */
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

/** Burn address used only as a read target while probing — never funded, never signed for. */
const PROBE_ADDRESS = '0x0000000000000000000000000000000000000001';

/**
 * True when a JSON-RPC error message is the endpoint asking for money, a key, or a slower client.
 * These arrive as HTTP 200 + an `error` body, so status codes alone do not catch them.
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

/** `11155111` -> `'eip155:11155111'` — the CAIP-2 form recent MetaMask network testids use. */
export function chainIdToCaip(chainId: number): string {
  assertChainId(chainId, 'chainIdToCaip');
  return `eip155:${chainId}`;
}

/**
 * Ordered RPC candidates: the chain-specific env override first, then the all-networks override,
 * then the preset's own list. De-duplicated, order preserved.
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
 * True when the endpoint is a plain JSON-RPC node actually serving this chain — rejects HTML,
 * redirects, auth/rate-limit walls, and nodes on a different chain. Never throws: the caller walks
 * a candidate list, and an endpoint that blows up is simply one that failed.
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
      // 402/407 are the paywall/proxy-auth codes a "free" endpoint returns once it decides you need
      // credentials; 451 and 5xx mean it is not serving this chain to us either.
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
    // Compare numerically: nodes answer `0xaa36a7`, `0xAA36A7` and `0x0aa36a7` interchangeably.
    let reported: bigint;
    try {
      reported = BigInt(chainBody.result);
    } catch {
      return false;
    }
    if (reported !== BigInt(chainId)) return false;

    // The methods a wallet actually needs to render a balance and estimate a fee, not just the
    // cheap read. Why the full set: docs/core-design-notes.md
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
 * The first candidate RPC that actually answers for this network. Throws listing every URL tried
 * when none passes — a dead RPC must fail here rather than inside a wallet's UI.
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
 * Bridges a Playwright page to its injected `window.ethereum` provider. Calls run in the dapp, so
 * they use the exact chain and RPC MetaMask selected instead of a second public endpoint.
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
 * Polls by transaction hash until a receipt exists (or timeout). Pass `network` to fail over
 * between that network's healthy RPCs, or `rpcUrl` to pin one endpoint. One of the two is
 * required: there is no default chain to guess.
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
