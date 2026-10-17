import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import {
  AA_RECEIPT_ATTACHMENT,
  assertSponsoredUserOperation,
  decodeUserOperationEvent,
  findUserOperationEvents,
  sponsoredUserOperation,
  verifySponsoredUserOperation,
  ZERO_ADDRESS,
  type EvmTransactionReceipt,
} from './aa.ts';

/**
 * A real Base Sepolia receipt (one unrelated log kept, then the EntryPoint's two): the T-REX
 * console deploying a suite as a sponsored operation from its operator identity.
 */
const RECEIPT: EvmTransactionReceipt & { transactionHash: string } = {
  "status": "0x1",
  "transactionHash": "0xb74e09146b54e9b27184cba2ff21862ed55c786c864a38e587ab75d96f4b9de9",
  "blockNumber": "0x2dee244",
  "logs": [
    {
      "address": "0x0fa7fbff0bdc71d31d29b972b8fb66a84fcdfa03",
      "topics": [
        "0xb145c091a4cf96f5c6710a7982a1ba9674b0fbd866522dd5a515e7eee1419c78",
        "0x000000000000000000000000ca064b8b8965f26ee1b0259d554286520e58f389",
        "0x841249f7a91b3707521f6384f5979e1cd3361d5ce786929a48bb88f549e0d40b"
      ],
      "data": "0xb99f630115fce47c65124e5884b58941c6e8dfb7aae32464340fa031a60563b8"
    },
    {
      "address": "0x433709009b8330fda32311df1c2afa402ed8d009",
      "topics": [
        "0xbb47ee3e183a558b1a2ff0874b079f3fc5478b7454eacf2bfc5af2ff5878f972"
      ],
      "data": "0x"
    },
    {
      "address": "0x433709009b8330fda32311df1c2afa402ed8d009",
      "topics": [
        "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f",
        "0xb99f630115fce47c65124e5884b58941c6e8dfb7aae32464340fa031a60563b8",
        "0x000000000000000000000000ca064b8b8965f26ee1b0259d554286520e58f389",
        "0x000000000000000000000000ca944fb73fa5191969014ded9bb075381d59c7de"
      ],
      "data": "0x0fa7fbff0bdc71d31d29b972b8fb66a84fcdfa03000000000000000000000052000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000a8b59f59a8000000000000000000000000000000000000000000000000000000000001d7bef"
    }
  ]
};

const EVIDENCE = {
  hash: RECEIPT.transactionHash,
  userOpHash: '0xb99f630115fce47c65124e5884b58941c6e8dfb7aae32464340fa031a60563b8',
  operator: '0xCa064B8b8965f26Ee1B0259D554286520e58f389',
};

const receipt = () => JSON.parse(JSON.stringify(RECEIPT)) as typeof RECEIPT;

describe('decodeUserOperationEvent', () => {
  it('decodes the indexed hashes and addresses and the packed data words', () => {
    const event = decodeUserOperationEvent(receipt().logs[2]);
    assert.deepEqual(event, {
      userOpHash: EVIDENCE.userOpHash,
      sender: EVIDENCE.operator.toLowerCase(),
      paymaster: '0xca944fb73fa5191969014ded9bb075381d59c7de',
      nonce: BigInt('0x0fa7fbff0bdc71d31d29b972b8fb66a84fcdfa03000000000000000000000052'),
      success: true,
      actualGasCost: BigInt('0xa8b59f59a80'),
      actualGasUsed: BigInt('0x1d7bef'),
    });
  });

  it('ignores logs of other events', () => {
    assert.equal(decodeUserOperationEvent(receipt().logs[0]), undefined);
    assert.equal(decodeUserOperationEvent(receipt().logs[1]), undefined);
  });
});

describe('findUserOperationEvents', () => {
  it('reads only the EntryPoint\'s events', () => {
    assert.equal(findUserOperationEvents(receipt()).length, 1);
    assert.equal(findUserOperationEvents(receipt(), { entryPoint: '0x0000000000000000000000000000000000000001' }).length, 0);
  });
});

describe('verifySponsoredUserOperation', () => {
  it('accepts the real receipt, case-insensitively', () => {
    const event = verifySponsoredUserOperation(receipt(), { ...EVIDENCE, userOpHash: EVIDENCE.userOpHash.toUpperCase().replace('0X', '0x') });
    assert.equal(event.success, true);
  });

  it('names the problem: wrong operator, missing paymaster, failed op, wrong count, reverted tx', () => {
    assert.throws(() => verifySponsoredUserOperation(receipt(), { ...EVIDENCE, operator: '0x0000000000000000000000000000000000000002' }), /sent by 0xca064b8b/);
    const unsponsored = receipt();
    unsponsored.logs[2].topics[3] = `0x${'0'.repeat(24)}${ZERO_ADDRESS.slice(2)}`;
    assert.throws(() => verifySponsoredUserOperation(unsponsored, EVIDENCE), /not sponsored/);
    const failed = receipt();
    failed.logs[2].data = failed.logs[2].data.slice(0, 2 + 64) + '0'.repeat(64) + failed.logs[2].data.slice(2 + 128);
    assert.throws(() => verifySponsoredUserOperation(failed, EVIDENCE), /reverted inside the account/);
    assert.throws(() => verifySponsoredUserOperation(receipt(), { ...EVIDENCE, userOpHash: `0x${'1'.repeat(64)}` }), /carries 0 UserOperationEvent/);
    assert.throws(() => verifySponsoredUserOperation({ ...receipt(), status: '0x0' }, EVIDENCE), /did not succeed/);
    assert.throws(() => verifySponsoredUserOperation(receipt(), { ...EVIDENCE, userOpHash: '' }), /no user operation hash/);
  });
});

describe('assertSponsoredUserOperation', () => {
  it('fetches the receipt and attaches the evidence', async () => {
    const attached: { name: string; body: string; contentType: string }[] = [];
    const rpc = { request: async ({ method }: { method: string }) => (method === 'eth_getTransactionReceipt' ? receipt() : null) };
    const { event } = await assertSponsoredUserOperation(rpc, EVIDENCE, {
      attach: { attach: async (name, { body, contentType }) => { attached.push({ name, body, contentType }); } },
    });
    assert.equal(event.userOpHash, EVIDENCE.userOpHash);
    assert.equal(attached.length, 1);
    assert.equal(attached[0].name, AA_RECEIPT_ATTACHMENT);
    assert.equal(attached[0].contentType, 'application/json');
    assert.deepEqual(Object.keys(JSON.parse(attached[0].body)), ['hash', 'userOpHash', 'operator', 'receipt']);
  });

  it('reports a receipt that is not there yet', async () => {
    const rpc = { request: async () => null };
    await assert.rejects(() => assertSponsoredUserOperation(rpc, EVIDENCE), /no receipt yet/);
  });

  it('as a settleWrite verifier, reads the operation from the probe state', async () => {
    const rpc = { request: async () => receipt() };
    await sponsoredUserOperation()({ hash: EVIDENCE.hash, state: { userOpHash: EVIDENCE.userOpHash, operator: EVIDENCE.operator }, rpc });
    await assert.rejects(() => sponsoredUserOperation()({ hash: EVIDENCE.hash, state: {}, rpc }), /no user operation hash/);
  });
});
