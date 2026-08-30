import {
  EVM_NETWORKS,
  resolveWorkingRpc,
  type EvmRpcRequester,
} from '@wallets-e2e/core';
import { createPublicClient, custom, http, parseAbi } from 'viem';
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

const DEPLOYED_PATH = join(import.meta.dirname, '../../metamask-spike/deployed.json');

export function loadDeployedContracts(): DeployedContracts {
  if (!existsSync(DEPLOYED_PATH)) {
    throw new Error(
      'deployed.json missing — run: node examples/metamask-spike/scripts/deploy.mjs',
    );
  }
  return JSON.parse(readFileSync(DEPLOYED_PATH, 'utf8')) as DeployedContracts;
}

export async function readVaultBalance(
  vaultAddress: string,
  userAddress: string,
  requester?: EvmRpcRequester,
): Promise<bigint> {
  const transport = requester
    ? custom(requester)
    : http(await resolveWorkingRpc(EVM_NETWORKS.sepolia));
  const client = createPublicClient({
    chain: sepolia,
    transport,
  });
  return client.readContract({
    address: vaultAddress as `0x${string}`,
    abi: vaultAbi,
    functionName: 'balanceOf',
    args: [userAddress as `0x${string}`],
  });
}

export const deployedContractsPath = DEPLOYED_PATH;
