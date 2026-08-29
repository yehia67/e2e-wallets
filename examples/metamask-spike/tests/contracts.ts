import { resolveWorkingSepoliaRpc } from '@wallets-e2e/core';
import { createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DeployedContracts {
  chainId: number;
  rpcUrl: string;
  tokenAddress: string;
  vaultAddress: string;
  depositAmount: string;
  tokenName: string;
  tokenSymbol: string;
}

const vaultAbi = parseAbi(['function balanceOf(address user) view returns (uint256)']);

const DEPLOYED_PATH = join(import.meta.dirname, '../deployed.sepolia.json');

export function loadDeployedContracts(): DeployedContracts {
  if (!existsSync(DEPLOYED_PATH)) {
    throw new Error(
      'deployed.sepolia.json missing — run: node examples/metamask-spike/scripts/deploy-sepolia.mjs',
    );
  }
  return JSON.parse(readFileSync(DEPLOYED_PATH, 'utf8')) as DeployedContracts;
}

export function requireDeployedContracts(testInfo: { skip: (condition: boolean, reason: string) => void }): DeployedContracts {
  const exists = existsSync(DEPLOYED_PATH);
  testInfo.skip(
    !exists,
    'deployed.sepolia.json missing — run: node examples/metamask-spike/scripts/deploy-sepolia.mjs',
  );
  return loadDeployedContracts();
}

export async function readVaultBalance(vaultAddress: string, userAddress: string): Promise<bigint> {
  const rpcUrl = await resolveWorkingSepoliaRpc();
  const client = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  return client.readContract({
    address: vaultAddress as `0x${string}`,
    abi: vaultAbi,
    functionName: 'balanceOf',
    args: [userAddress as `0x${string}`],
  });
}
