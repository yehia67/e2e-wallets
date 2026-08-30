import type { StacksTxStatus } from '../index.js';

/**
 * `waitForTransactionMined` returns an abort status rather than throwing on one — a mined-then-
 * rejected transaction is a successful poll but a failed step. Its own pure function so
 * `node --test` can cover the abort branches a real testnet run never produces.
 */
export function assertMinedStatus(txid: string, status: StacksTxStatus): void {
  if (status === 'success') return;

  throw new Error(
    `[@wallets-e2e/core/bdd] Transaction ${txid} did not succeed — the chain reported ` +
      `"${status}". ` +
      (status === 'abort_by_post_condition'
        ? `A post-condition on the transaction rejected it after it was mined.`
        : status === 'abort_by_response'
          ? `The contract call ran and returned an error response.`
          : `The transaction was mined but is not in a success state.`),
  );
}
