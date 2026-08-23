// Requests real testnet STX from Hiro's public testnet faucet for this repo's single fixture
// wallet (wallets/leather/fixtures/devnet-wallet.ts). Plain Node script, run manually before
// tests that need a funded balance -- the faucet is rate-limited (one request per address per
// ~5 minutes), so this is not run automatically as part of every test run.
//
// Usage: node scripts/fund-fixture-wallet-testnet.mjs

const FIXTURE_TESTNET_ADDRESS = 'ST1QM4Q2BM7SXWTECDSJB7SAEBMQQN741F32V9N05';
const FAUCET_URL = `https://api.testnet.hiro.so/extended/v1/faucets/stx?address=${FIXTURE_TESTNET_ADDRESS}&stacking=false`;

const response = await fetch(FAUCET_URL, { method: 'POST' });
const body = await response.json();

if (!response.ok || body.success === false) {
  console.error(`Faucet request failed (${response.status}):`, JSON.stringify(body));
  process.exit(1);
}

console.log('Faucet request accepted:', JSON.stringify(body));
console.log(
  `Check balance: curl -sSL "https://api.testnet.hiro.so/extended/v1/address/${FIXTURE_TESTNET_ADDRESS}/stx"`,
);
