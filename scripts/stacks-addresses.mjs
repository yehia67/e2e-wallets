#!/usr/bin/env node
// Prints the Stacks addresses Leather derives from WALLETS_E2E_SEED_PHRASE (account 0), so the
// matching WALLETS_E2E_MAINNET_ADDRESS / WALLETS_E2E_TESTNET_ADDRESS can be set. The seed is read
// from the environment or the root .env files and is never printed.
import { generateWallet, getStxAddress } from '@stacks/wallet-sdk';
import { loadEnvFiles } from '../packages/core/dist/env.js';

loadEnvFiles({ cwd: process.cwd() });
const secretKey = process.env.WALLETS_E2E_SEED_PHRASE?.trim();
if (!secretKey) {
  console.error('WALLETS_E2E_SEED_PHRASE is not set (environment or root .env files).');
  process.exit(1);
}
const wallet = await generateWallet({ secretKey, password: 'derive-only' });
const [account] = wallet.accounts;
console.log(`WALLETS_E2E_MAINNET_ADDRESS=${getStxAddress({ account, network: 'mainnet' })}`);
console.log(`WALLETS_E2E_TESTNET_ADDRESS=${getStxAddress({ account, network: 'testnet' })}`);
