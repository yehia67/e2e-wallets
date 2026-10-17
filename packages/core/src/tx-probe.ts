// No runtime imports: `node --test` runs this straight from source.
import type { Page } from '@playwright/test';

export type TxProbeStatus = 'idle' | 'pending' | 'submitted' | 'confirmed' | 'failed';

/**
 * What the app publishes about its latest write.
 *
 * The contract the app side implements (any framework, ~30 lines):
 * - render `<div data-testid="<testId>" data-status data-hash data-user-op-hash data-operator
 *   data-sponsored data-error data-block-number aria-hidden>` somewhere in the document, updated
 *   on every transition of the latest write;
 * - dispatch `window` `CustomEvent('<eventPrefix>:transaction', { detail: state })` on every
 *   transition, so a flow of several chained writes can be followed even though the element only
 *   ever shows the last one;
 * - listen for `window` event `<eventPrefix>:clear-last-tx` and go back to `idle`.
 */
export interface TxProbeState {
  status: TxProbeStatus;
  hash: string;
  error: string;
  /** ERC-4337: the user operation the hash mined. */
  userOpHash?: string;
  /** ERC-4337: the smart account that sent it. */
  operator?: string;
  /** ERC-4337: whether a paymaster paid, as the app saw it. */
  sponsored?: boolean;
  blockNumber?: string;
  updatedAt?: number;
}

export interface TxProbeOptions {
  /** `data-testid` of the probe element. Default `last-tx`. */
  testId?: string;
  /** Prefix of the two window events. Default `wallets-e2e`. */
  eventPrefix?: string;
  /** How often the element is read while waiting. Default 250 ms. */
  pollMs?: number;
}

export interface TxProbe {
  /** Puts the probe back to `idle`, so the next write is unambiguous. */
  clear(options?: { timeoutMs?: number }): Promise<void>;
  /** The element's current state. */
  read(): Promise<TxProbeState>;
  /** The hash of the write in flight. Fails at once when the app reports the write failed. */
  waitForHash(options?: { timeoutMs?: number }): Promise<string>;
  /** Starts recording every transition the app publishes; call before the action that writes. */
  captureAll(): Promise<void>;
  /** The settled writes recorded so far: confirmed, sponsored, with a user operation hash, one per hash. */
  captured(): TxProbeState[];
  /** The `index`-th settled write, or a failure the app published meanwhile. */
  waitForCaptured(index: number, options?: { timeoutMs?: number }): Promise<TxProbeState>;
}

export const TX_PROBE_ATTRIBUTES = [
  'data-status', 'data-hash', 'data-user-op-hash', 'data-operator', 'data-sponsored', 'data-error', 'data-block-number',
] as const;

const HASH = /^0x[0-9a-f]{64}$/i;

/** The element's `data-*` attributes as a state; absent attributes read as idle and empty. */
export function parseProbeAttributes(attributes: Record<string, string | null | undefined>): TxProbeState {
  const get = (name: string): string | undefined => {
    const value = attributes[name];
    return value === null || value === undefined ? undefined : value;
  };
  const status = get('data-status') as TxProbeStatus | undefined;
  const sponsored = get('data-sponsored');
  return {
    status: status ?? 'idle',
    hash: get('data-hash') ?? '',
    error: get('data-error') ?? '',
    ...(get('data-user-op-hash') ? { userOpHash: get('data-user-op-hash') } : {}),
    ...(get('data-operator') ? { operator: get('data-operator') } : {}),
    ...(sponsored !== undefined ? { sponsored: sponsored === 'true' } : {}),
    ...(get('data-block-number') ? { blockNumber: get('data-block-number') } : {}),
  };
}

/** A transition worth recording: the write is on chain, a paymaster paid, and the operation is named. */
export function isSettledTransition(state: Partial<TxProbeState>): state is TxProbeState & { userOpHash: string } {
  return state.status === 'confirmed' && state.sponsored === true && !!state.userOpHash && HASH.test(state.hash ?? '');
}

export function describeFailure(state: Partial<TxProbeState>): string {
  return `the app reported the write as failed: ${state.error?.trim() || 'no reason recorded'} (hash=${state.hash || 'none'})`;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createTxProbe(page: Page, options: TxProbeOptions = {}): TxProbe {
  const { testId = 'last-tx', eventPrefix = 'wallets-e2e', pollMs = 250 } = options;
  const clearEvent = `${eventPrefix}:clear-last-tx`;
  const transactionEvent = `${eventPrefix}:transaction`;
  const binding = `__walletsE2ETxProbe_${testId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const recorded: TxProbeState[] = [];
  let failure: string | undefined;
  let capturing = false;

  const read = async (): Promise<TxProbeState> => {
    const attributes = await page.getByTestId(testId).evaluate(
      (element, names) => Object.fromEntries(names.map((name) => [name, element.getAttribute(name)])),
      [...TX_PROBE_ATTRIBUTES],
    );
    return parseProbeAttributes(attributes);
  };

  return {
    read,

    async clear({ timeoutMs = 10_000 } = {}) {
      await page.evaluate((event) => { window.dispatchEvent(new Event(event)); }, clearEvent);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((await read()).status === 'idle') return;
        await sleep(pollMs);
      }
      throw new Error(`The transaction probe "${testId}" did not return to idle after "${clearEvent}".`);
    },

    async waitForHash({ timeoutMs = 60_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let last: TxProbeState | undefined;
      while (Date.now() < deadline) {
        last = await read();
        if (last.status === 'failed') throw new Error(describeFailure(last));
        if (HASH.test(last.hash) && (last.status === 'submitted' || last.status === 'confirmed')) return last.hash;
        await sleep(pollMs);
      }
      throw new Error(`Timed out waiting for a transaction hash on "${testId}" (status=${last?.status}, hash=${last?.hash || 'none'}).`);
    },

    async captureAll() {
      if (capturing) return;
      capturing = true;
      recorded.length = 0;
      failure = undefined;
      // Recorded in Node, not on `window`: a navigation would wipe a page-side record, and the
      // init script re-subscribes every new document.
      await page.exposeBinding(binding, (_source, detail: Partial<TxProbeState>) => {
        if (detail.status === 'failed') failure = describeFailure(detail);
        if (isSettledTransition(detail) && !recorded.some((state) => state.hash === detail.hash)) recorded.push({ ...detail });
      });
      const subscribe = ({ event, call }: { event: string; call: string }): void => {
        window.addEventListener(event, (raised) => {
          const detail = (raised as CustomEvent<unknown>).detail;
          const forward = (window as unknown as Record<string, (value: unknown) => Promise<void>>)[call];
          void forward?.(detail).catch(() => undefined);
        });
      };
      await page.addInitScript(subscribe, { event: transactionEvent, call: binding });
      await page.evaluate(subscribe, { event: transactionEvent, call: binding });
    },

    captured: () => [...recorded],

    async waitForCaptured(index, { timeoutMs = 180_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (recorded[index]) return recorded[index];
        if (failure) throw new Error(failure);
        await sleep(pollMs);
      }
      throw new Error(`Timed out waiting for write ${index + 1} on "${testId}": ${recorded.length} recorded so far.`);
    },
  };
}
