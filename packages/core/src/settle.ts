// No runtime imports: `node --test` runs this straight from source.
import type { EvmRpcRequester } from './evm.js';
import type { TxProbe, TxProbeState } from './tx-probe.js';

export interface SettleWriteOptions {
  /** The app's transaction probe; `waitForHash` and `read` are all that is used. */
  probe: Pick<TxProbe, 'waitForHash' | 'read'>;
  /** Where receipts are read from; `createInjectedEvmRpc(page)` uses the wallet's own provider. */
  rpc: EvmRpcRequester;
  /** The on-chain (or UI) state the write must have produced. Retried until it holds or time runs out. */
  assertState: () => Promise<void>;
  /** Extra checks on the mined receipt, e.g. `sponsoredUserOperation()` for ERC-4337 writes. */
  verifyReceipt?: (context: { hash: string; state: TxProbeState; rpc: EvmRpcRequester }) => Promise<void>;
  /** How long the hash may take to mine. Default 45 s. */
  receiptTimeoutMs?: number;
  /** How long `assertState` may keep failing. Default 90 s. */
  stateTimeoutMs?: number;
  /** Pause between `assertState` attempts. Default 1.5 s. */
  statePollMs?: number;
}

export interface SettledWrite {
  hash: string;
  receipt: 'success';
  /** The probe as it stood when the hash appeared. */
  state: TxProbeState;
}

interface Receipt {
  status: string;
  [field: string]: unknown;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The receipt once it is mined and succeeded; a reverted transaction or a timeout is an error. */
export async function waitForSuccessfulReceipt(
  rpc: EvmRpcRequester,
  hash: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<Receipt> {
  const { timeoutMs = 45_000, pollMs = 1_500 } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = (await rpc.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as Receipt | null;
    if (receipt?.status === '0x1') return receipt;
    if (receipt && receipt.status !== undefined && receipt.status !== null && receipt.status !== '0x1') {
      throw new Error(`Transaction ${hash} did not succeed: status ${receipt.status}.`);
    }
    await sleep(pollMs);
  }
  throw new Error(`Transaction ${hash} was not mined within ${timeoutMs} ms.`);
}

/**
 * After the wallet confirmed: read the hash from the probe, wait for its receipt, run the extra
 * receipt checks, then keep asserting the resulting state until it holds.
 *
 * The state is polled because a read can lag the write: the app's RPC may answer from a node that
 * has not seen the block yet, and the UI refreshes on its own schedule. The receipt is never
 * polled past its timeout, and a reverted transaction fails at once.
 */
export async function settleWrite(options: SettleWriteOptions): Promise<SettledWrite> {
  const {
    probe, rpc, assertState, verifyReceipt,
    receiptTimeoutMs = 45_000, stateTimeoutMs = 90_000, statePollMs = 1_500,
  } = options;

  const hash = await probe.waitForHash({ timeoutMs: receiptTimeoutMs });
  const state = await probe.read();
  await waitForSuccessfulReceipt(rpc, hash, { timeoutMs: receiptTimeoutMs });
  if (verifyReceipt) await verifyReceipt({ hash, state, rpc });

  const deadline = Date.now() + stateTimeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertState();
      return { hash, receipt: 'success', state };
    } catch (error) {
      lastError = error;
      await sleep(statePollMs);
    }
  }
  throw lastError instanceof Error
    ? new Error(`The state after ${hash} never matched within ${stateTimeoutMs} ms: ${lastError.message}`, { cause: lastError })
    : new Error(`The state after ${hash} never matched within ${stateTimeoutMs} ms.`);
}
