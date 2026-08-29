#!/usr/bin/env node
/**
 * Deploy TestToken + DepositVault to Sepolia and mint test tokens to the fixture wallet.
 *
 * Prerequisites:
 *   - forge build (OpenZeppelin deps installed)
 *   - wallets/metamask/.env.local with WALLETS_E2E_ETH_PRIVATE_KEY and WALLETS_E2E_ETH_ADDRESS
 *   - Sepolia ETH on the deployer address
 *
 * Usage (from repo root):
 *   node examples/metamask-spike/scripts/deploy-sepolia.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { resolveWorkingSepoliaRpc } from '@wallets-e2e/core';

const spikeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(spikeRoot, '..', '..');

function loadEnvLocal() {
  const candidates = [
    join(repoRoot, 'wallets/metamask/.env.local'),
    join(spikeRoot, '.env.local'),
  ];
  const envPath = candidates.find((p) => existsSync(p));
  if (!envPath) {
    throw new Error(
      'No .env.local found — run: node wallets/metamask/scripts/generate-fixture-wallet.mjs',
    );
  }
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readArtifact(contractName) {
  const path = join(spikeRoot, 'out', `${contractName}.sol`, `${contractName}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Artifact missing at ${path} — run: cd examples/metamask-spike && forge build`,
    );
  }
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

const MINT_AMOUNT = parseEther('10000');
const DEPOSIT_AMOUNT = parseEther('1');
const SEPOLIA_RPC_URL = await resolveWorkingSepoliaRpc();
console.log('Using Sepolia RPC (no API key):', SEPOLIA_RPC_URL);

const env = loadEnvLocal();
const privateKey = env.WALLETS_E2E_ETH_PRIVATE_KEY?.trim();
const recipient = env.WALLETS_E2E_ETH_ADDRESS?.trim();
if (!privateKey || !recipient) {
  throw new Error(
    'WALLETS_E2E_ETH_PRIVATE_KEY and WALLETS_E2E_ETH_ADDRESS required in wallets/metamask/.env.local',
  );
}

const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL),
});

const tokenArtifact = readArtifact('TestToken');
const vaultArtifact = readArtifact('DepositVault');

console.log('Deploying TestToken from', account.address);
const tokenHash = await walletClient.deployContract({
  abi: tokenArtifact.abi,
  bytecode: tokenArtifact.bytecode,
  args: [],
});
const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash });
const tokenAddress = tokenReceipt.contractAddress;
if (!tokenAddress) throw new Error('TestToken deploy failed — no contract address');

console.log('TestToken:', tokenAddress);

console.log('Deploying DepositVault');
const vaultHash = await walletClient.deployContract({
  abi: vaultArtifact.abi,
  bytecode: vaultArtifact.bytecode,
  args: [tokenAddress],
});
const vaultReceipt = await publicClient.waitForTransactionReceipt({ hash: vaultHash });
const vaultAddress = vaultReceipt.contractAddress;
if (!vaultAddress) throw new Error('DepositVault deploy failed — no contract address');

console.log('DepositVault:', vaultAddress);

const tokenAbi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const transferHash = await walletClient.writeContract({
  address: tokenAddress,
  abi: tokenAbi,
  functionName: 'transfer',
  args: [recipient, MINT_AMOUNT],
});
await publicClient.waitForTransactionReceipt({ hash: transferHash });
console.log(`Minted ${MINT_AMOUNT} tokens to fixture wallet ${recipient}`);

const deployed = {
  chainId: sepolia.id,
  rpcUrl: SEPOLIA_RPC_URL,
  tokenAddress,
  vaultAddress,
  depositAmount: DEPOSIT_AMOUNT.toString(),
  tokenName: 'Wallets E2E Test',
  tokenSymbol: 'WET',
};

const outPaths = [
  join(spikeRoot, 'deployed.sepolia.json'),
  join(spikeRoot, 'public', 'deployed.sepolia.json'),
];
for (const outPath of outPaths) {
  writeFileSync(outPath, `${JSON.stringify(deployed, null, 2)}\n`);
  console.log('Written', outPath);
}
