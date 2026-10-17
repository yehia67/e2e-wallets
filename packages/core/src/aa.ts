// No runtime imports: `node --test` runs this straight from source, and keeping the decoding
// by hand keeps the package free of an ABI library it would otherwise need for one event.
import type { EvmRpcRequester } from './evm.js';

/** ERC-4337 EntryPoint v0.9, the same address on every chain it is deployed to. */
export const ENTRY_POINT_V09_ADDRESS = '0x433709009b8330fda32311df1c2afa402ed8d009';

/** `keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)")`. */
export const USER_OPERATION_EVENT_TOPIC = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** The attachment a verified sponsored operation leaves on the test, for reports and evidence. */
export const AA_RECEIPT_ATTACHMENT = 'confirmed-aa-transaction';

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
}

export interface EvmTransactionReceipt {
  status: string;
  logs: EvmLog[];
  [field: string]: unknown;
}

/** `UserOperationEvent` as the EntryPoint emits it once per user operation it executed. */
export interface UserOperationEvent {
  userOpHash: string;
  sender: string;
  paymaster: string;
  nonce: bigint;
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
}

const word = (hex: string, index: number): string => hex.slice(2 + index * 64, 2 + (index + 1) * 64);
const addressOfWord = (hex: string): string => `0x${hex.slice(-40)}`.toLowerCase();

/** Decodes one log if it is a `UserOperationEvent`, whatever contract emitted it. */
export function decodeUserOperationEvent(log: EvmLog): UserOperationEvent | undefined {
  if (log.topics.length !== 4 || log.topics[0].toLowerCase() !== USER_OPERATION_EVENT_TOPIC) return undefined;
  if (log.data.length < 2 + 4 * 64) return undefined;
  return {
    userOpHash: log.topics[1].toLowerCase(),
    sender: addressOfWord(log.topics[2]),
    paymaster: addressOfWord(log.topics[3]),
    nonce: BigInt(`0x${word(log.data, 0)}`),
    success: BigInt(`0x${word(log.data, 1)}`) === 1n,
    actualGasCost: BigInt(`0x${word(log.data, 2)}`),
    actualGasUsed: BigInt(`0x${word(log.data, 3)}`),
  };
}

/** Every `UserOperationEvent` the given EntryPoint emitted in the receipt. */
export function findUserOperationEvents(
  receipt: EvmTransactionReceipt,
  options: { entryPoint?: string } = {},
): UserOperationEvent[] {
  const entryPoint = (options.entryPoint ?? ENTRY_POINT_V09_ADDRESS).toLowerCase();
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === entryPoint)
    .map(decodeUserOperationEvent)
    .filter((event): event is UserOperationEvent => event !== undefined);
}

export interface SponsoredUserOperationEvidence {
  /** The transaction the bundler mined the operation in. */
  hash: string;
  /** The operation's hash, as the app reported it. */
  userOpHash: string;
  /** The smart account that sent it: the identity, not the signing wallet. */
  operator: string;
}

/**
 * Checks that the receipt carries exactly one successful `UserOperationEvent` for the operation,
 * sent by the operator and paid by a paymaster. Each check throws a sentence that says what the
 * chain showed instead, so a wrong receipt names its own problem.
 */
export function verifySponsoredUserOperation(
  receipt: EvmTransactionReceipt,
  evidence: SponsoredUserOperationEvidence,
  options: { entryPoint?: string } = {},
): UserOperationEvent {
  const { hash, userOpHash, operator } = evidence;
  if (!/^0x[0-9a-f]{64}$/i.test(userOpHash)) throw new Error(`The app reported no user operation hash for ${hash} (got "${userOpHash}").`);
  if (!/^0x[0-9a-f]{40}$/i.test(operator)) throw new Error(`The app reported no operator for ${hash} (got "${operator}").`);
  if (receipt.status !== '0x1') throw new Error(`Transaction ${hash} did not succeed: status ${receipt.status}.`);
  const matches = findUserOperationEvents(receipt, options)
    .filter((event) => event.userOpHash === userOpHash.toLowerCase());
  if (matches.length !== 1) {
    throw new Error(`Transaction ${hash} carries ${matches.length} UserOperationEvent(s) for ${userOpHash}; expected exactly one.`);
  }
  const [event] = matches;
  if (!event.success) throw new Error(`User operation ${userOpHash} was mined but reverted inside the account.`);
  if (event.sender !== operator.toLowerCase()) throw new Error(`User operation ${userOpHash} was sent by ${event.sender}, not the operator ${operator}.`);
  if (event.paymaster === ZERO_ADDRESS) throw new Error(`User operation ${userOpHash} was not sponsored: no paymaster paid for it.`);
  return event;
}

/** The part of Playwright's `TestInfo` the attachment needs. */
export interface AttachmentTarget {
  attach(name: string, options: { body: string; contentType: string }): Promise<void>;
}

/**
 * Fetches the receipt and verifies the sponsored operation in it. With `attach`, the hash, the
 * operation hash, the operator and the receipt are attached as `confirmed-aa-transaction`
 * (JSON), which is what reports and the evidence site read the transaction links from.
 */
export async function assertSponsoredUserOperation(
  rpc: EvmRpcRequester,
  evidence: SponsoredUserOperationEvidence,
  options: { entryPoint?: string; attach?: AttachmentTarget } = {},
): Promise<{ receipt: EvmTransactionReceipt; event: UserOperationEvent }> {
  const receipt = (await rpc.request({ method: 'eth_getTransactionReceipt', params: [evidence.hash] })) as EvmTransactionReceipt | null;
  if (!receipt) throw new Error(`Transaction ${evidence.hash} has no receipt yet.`);
  const event = verifySponsoredUserOperation(receipt, evidence, options);
  if (options.attach) {
    await options.attach.attach(AA_RECEIPT_ATTACHMENT, {
      body: JSON.stringify({ hash: evidence.hash, userOpHash: evidence.userOpHash, operator: evidence.operator, receipt }),
      contentType: 'application/json',
    });
  }
  return { receipt, event };
}

/**
 * A `verifyReceipt` for `settleWrite`: the operation hash and operator come from what the app
 * published on its transaction probe alongside the hash.
 */
export function sponsoredUserOperation(
  options: { entryPoint?: string; attach?: AttachmentTarget } = {},
): (context: { hash: string; state: { userOpHash?: string; operator?: string }; rpc: EvmRpcRequester }) => Promise<void> {
  return async ({ hash, state, rpc }) => {
    await assertSponsoredUserOperation(rpc, {
      hash, userOpHash: state.userOpHash ?? '', operator: state.operator ?? '',
    }, options);
  };
}
