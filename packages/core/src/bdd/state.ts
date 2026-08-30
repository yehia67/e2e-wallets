import type { BrowserContext } from '../index.js';
import type { SupportedStacksNetwork } from './networks.js';

// Scratch space the wallet steps pass values through, keyed by the scenario's own `BrowserContext`.
// That is not isolation on its own — a worker-scoped context is shared — hence `resetWalletState`.

/** A dapp-side action, queued to be run *inside* a driver's `trigger()` callback. */
export type WalletTrigger = () => Promise<void>;

interface WalletStepState {
  /** The network the `I am connected to ...` step resolved, so later steps poll the right RPC. */
  network?: SupportedStacksNetwork;
  /** A dapp-side action queued by a consumer step, waiting to be run inside `trigger()`. */
  pendingTrigger?: WalletTrigger;
  /** The transaction id a consumer step read off the dapp. */
  txid?: string;
}

const stateByContext = new WeakMap<object, WalletStepState>();

function stateFor(context: BrowserContext): WalletStepState {
  let state = stateByContext.get(context);
  if (!state) {
    state = {};
    stateByContext.set(context, state);
  }
  return state;
}

/** Clears everything this context carries, so a scenario never inherits a previous one's state. */
export function resetWalletState(context: BrowserContext): void {
  stateByContext.set(context, {});
}

/** Records which network the connect step put the wallet on. */
export function setWalletNetwork(context: BrowserContext, network: SupportedStacksNetwork): void {
  stateFor(context).network = network;
}

/** The network the connect step resolved, if it has run for this context. */
export function walletNetwork(context: BrowserContext): SupportedStacksNetwork | undefined {
  return stateByContext.get(context)?.network;
}

/**
 * Queues the dapp-side action that opens a wallet popup, for the approval step to run *inside* the
 * driver's `trigger()` callback. A consumer step must never click the button itself: the driver
 * registers its popup listener before awaiting `trigger()`, so an earlier click is missed entirely.
 *
 * ```ts
 * When('I request a transfer of {int} STX', async ({ context, page }) => {
 *   queueWalletTrigger(context, async () => {
 *     await page.getByTestId('send-stx').click();
 *   });
 * });
 * ```
 */
export function queueWalletTrigger(context: BrowserContext, trigger: WalletTrigger): void {
  const state = stateFor(context);
  if (state.pendingTrigger) {
    throw new Error(
      `[@wallets-e2e/core/bdd] A wallet action is already queued and has not been approved yet. ` +
        `Each step that queues one needs its own "I approve the wallet popup" step after it — ` +
        `queueing twice would silently discard the first action.`,
    );
  }
  state.pendingTrigger = trigger;
}

/** One-shot: leaving it in place would let a second approval step re-run the previous action. */
export function takeWalletTrigger(context: BrowserContext): WalletTrigger {
  const state = stateFor(context);
  const trigger = state.pendingTrigger;
  if (!trigger) {
    throw new Error(
      `[@wallets-e2e/core/bdd] "I approve the wallet popup" ran with no pending wallet action. ` +
        `The step before it must queue the dapp-side click with queueWalletTrigger(context, fn) ` +
        `instead of clicking directly — the click has to run inside the driver's trigger() ` +
        `callback, or the popup opens before anything is listening for it.`,
    );
  }
  state.pendingTrigger = undefined;
  return trigger;
}

/** A Stacks transaction id: 32 bytes of hex, with or without the `0x` prefix `@stacks/connect` omits. */
const TXID_PATTERN = /^(0x)?[0-9a-f]{64}$/i;

/**
 * Records the txid a consumer step read off the dapp. The shape is validated here so scraping the
 * wrong element fails at that step, not as a 15-minute poll for a txid that cannot exist.
 */
export function recordTransactionId(context: BrowserContext, txid: string): void {
  const trimmed = txid.trim();
  if (!TXID_PATTERN.test(trimmed)) {
    throw new Error(
      `[@wallets-e2e/core/bdd] "${txid}" is not a Stacks transaction id (expected 64 hex ` +
        `characters, optionally 0x-prefixed). Check the element the step read it from — a stray ` +
        `label or an empty locator match is the usual cause.`,
    );
  }
  const state = stateFor(context);
  if (state.txid) {
    throw new Error(
      `[@wallets-e2e/core/bdd] A transaction id is already recorded for this scenario ` +
        `("${state.txid}"). Call recordTransactionId once per scenario — overwriting would make ` +
        `"the transaction is mined" poll the later id and drop the earlier one.`,
    );
  }
  state.txid = trimmed;
}

/** The recorded txid, or a named error explaining which step should have recorded one. */
export function requireTransactionId(context: BrowserContext): string {
  const txid = stateByContext.get(context)?.txid;
  if (!txid) {
    throw new Error(
      `[@wallets-e2e/core/bdd] "the transaction is mined" ran with no transaction id recorded. ` +
        `An earlier step must read the txid off your dapp and call ` +
        `recordTransactionId(context, txid).`,
    );
  }
  return txid;
}
