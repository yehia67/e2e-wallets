/** Every network Leather's own picker offers, mapped to the RPC host it shows for each. */
export type StacksNetwork = 'mainnet' | 'testnet4' | 'testnet3' | 'signet' | 'devnet';

/** The subset of `StacksNetwork` a `WalletDriver` can actually be placed on today. */
export type SupportedStacksNetwork = Extract<StacksNetwork, 'mainnet' | 'testnet4'>;

export const STACKS_NETWORK_RPC_URLS: Record<StacksNetwork, string> = {
  mainnet: 'https://api.hiro.so',
  testnet4: 'https://api.testnet.hiro.so',
  testnet3: 'https://api.testnet.hiro.so',
  signet: 'https://api.testnet.hiro.so',
  devnet: 'http://localhost:3999',
};

/**
 * Default RPC for chain-facing checks. Why real testnet and not a local devnet:
 * docs/core-design-notes.md
 */
export const TESTNET_RPC_URL: string = STACKS_NETWORK_RPC_URLS.testnet4;

/** What the Stacks API's `/extended/v1/tx/:txid` endpoint reports for a transaction's fate. */
export type StacksTxStatus =
  | 'pending'
  | 'success'
  | 'abort_by_response'
  | 'abort_by_post_condition'
  | 'not_found';

/**
 * Polls a Stacks API by transaction ID until it's mined (or definitively failed) — "the popup
 * closed" is never proof of broadcast. Real testnet block times are ~10 minutes; size `timeoutMs`
 * accordingly.
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
