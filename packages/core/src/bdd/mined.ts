import type { StacksTxStatus } from '../index.js';

/**
 * `waitForTransactionMined` *returns* an abort status rather than throwing on one — a transaction
 * that was mined and then rejected is a perfectly successful poll. For a `Then the transaction is
 * mined` step it is a failure, and this is what turns it into one.
 *
 * Kept as its own pure function, apart from `./index.ts` (the only module that imports
 * `playwright-bdd`), because the real testnet run only ever produces `success`: inlined in the step
 * this branch is unreachable from any test, and deleting it would leave the suite green. Here
 * `node --test` covers both abort statuses directly.
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
