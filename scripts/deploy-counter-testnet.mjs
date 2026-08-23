// Deploys contracts/counter.clar to real Stacks testnet from this repo's fixture wallet. One-time
// setup, run manually -- not part of any automated test. Requires the fixture wallet to already
// hold real testnet STX (see examples/react-connect/scripts/fund-fixture-wallet-testnet.mjs).
//
// Usage: node scripts/deploy-counter-testnet.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeContractDeploy, broadcastTransaction } from '@stacks/transactions';
import { generateWallet } from '@stacks/wallet-sdk';

// wallets/leather/fixtures/devnet-wallet.ts -- the single fixture wallet this repo's tests
// unlock Leather with. Never a real-value seed, checked into this repo in the clear on purpose.
const FIXTURE_SEED_PHRASE =
  'borrow poverty valid fee tape access zebra sustain luxury buddy account only prepare nasty van rotate wool farm region brave season half relax donkey';

const wallet = await generateWallet({ secretKey: FIXTURE_SEED_PHRASE, password: 'unused' });
const senderKey = wallet.accounts[0].stxPrivateKey;

const contractPath = fileURLToPath(new URL('../contracts/counter.clar', import.meta.url));
const codeBody = readFileSync(contractPath, 'utf8');

const tx = await makeContractDeploy({
  contractName: 'counter',
  codeBody,
  senderKey,
  network: 'testnet',
  fee: 5000n,
});

const result = await broadcastTransaction({ transaction: tx, network: 'testnet' });
if (!('txid' in result)) {
  console.error('Deploy broadcast failed:', JSON.stringify(result));
  process.exit(1);
}
console.log('Deploy txid:', result.txid);
console.log(`Check status: curl -sSL "https://api.testnet.hiro.so/extended/v1/tx/0x${result.txid}"`);
