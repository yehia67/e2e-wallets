import {
  createPublicClient,
  createWalletClient,
  custom,
  parseAbi,
  parseEther,
  hexToSignature,
  type EIP1193Provider,
} from 'viem';
import { sepolia } from 'viem/chains';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const DEPOSIT_AMOUNT = parseEther('1');

const connectBtn = document.querySelector('[data-testid="connect-wallet"]');
const sendEthBtn = document.querySelector('[data-testid="send-eth"]');
const approveBtn = document.querySelector('[data-testid="approve-token"]');
const depositBtn = document.querySelector('[data-testid="deposit-after-approve"]');
const permitSignBtn = document.querySelector('[data-testid="deposit-permit-sign"]');
const permitSubmitBtn = document.querySelector('[data-testid="deposit-permit-submit"]');
const addrEl = document.querySelector('[data-testid="connected-address"]');
const txEl = document.querySelector('[data-testid="tx-hash"]');
const depositStatusEl = document.querySelector('[data-testid="deposit-status"]');

interface DeployedConfig {
  chainId: number;
  rpcUrl: string;
  tokenAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  tokenName: string;
}

let deployed: DeployedConfig | null = null;
let permitSignature: { signature: `0x${string}`; deadline: bigint } | null = null;

const tokenAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
]);

const vaultAbi = parseAbi([
  'function deposit(uint256 amount)',
  'function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function balanceOf(address user) view returns (uint256)',
]);

async function loadDeployed(): Promise<DeployedConfig> {
  const res = await fetch('/deployed.json');
  if (!res.ok) {
    throw new Error('deployed.json missing — run: node examples/metamask-spike/scripts/deploy.mjs');
  }
  deployed = (await res.json()) as DeployedConfig;
  return deployed;
}

function getWalletClient() {
  if (!window.ethereum) throw new Error('No injected wallet');
  return createWalletClient({
    chain: sepolia,
    transport: custom(window.ethereum),
  });
}

async function getAccount(): Promise<`0x${string}`> {
  if (!window.ethereum) throw new Error('No injected wallet');
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts[0] as `0x${string}`;
}

async function ensureDeployedChain(): Promise<void> {
  if (!window.ethereum) throw new Error('No injected wallet');
  let cfg: DeployedConfig;
  try {
    cfg = await loadDeployed();
  } catch {
    return;
  }
  const want = `0x${cfg.chainId.toString(16)}`;
  const chainId = ((await window.ethereum.request({ method: 'eth_chainId' })) as string).toLowerCase();
  if (chainId === want) return;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: want }],
    });
  } catch {
  }
}

connectBtn!.addEventListener('click', async () => {
  if (!window.ethereum) throw new Error('No injected wallet');
  await ensureDeployedChain();
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  addrEl!.textContent = accounts[0] ?? '';
});

sendEthBtn!.addEventListener('click', async () => {
  txEl!.textContent = '';
  try {
    if (!window.ethereum) throw new Error('No injected wallet');
    await ensureDeployedChain();
    const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[];
    const from = accounts[0];
    if (!from) throw new Error('Not connected — click Connect first');
    const value = '0x5af3107a4000';
    const txHash = (await window.ethereum.request({
      method: 'eth_sendTransaction',

      params: [{ from, to: from, value }] as unknown as [Record<string, string>],
    })) as string;
    txEl!.textContent = txHash;
  } catch (err) {
    txEl!.textContent = `error: ${(err as Error)?.message ?? String(err)}`;
    throw err;
  }
});

approveBtn!.addEventListener('click', async () => {
  depositStatusEl!.textContent = 'approve-pending';
  try {
    const cfg = await loadDeployed();
    const account = await getAccount();
    const walletClient = getWalletClient();
    const hash = await walletClient.writeContract({
      account,
      address: cfg.tokenAddress,
      abi: tokenAbi,
      functionName: 'approve',
      args: [cfg.vaultAddress, DEPOSIT_AMOUNT],
    });
    depositStatusEl!.textContent = `approve-tx:${hash}`;
  } catch (err) {
    depositStatusEl!.textContent = `error: ${(err as Error)?.message ?? String(err)}`;
    throw err;
  }
});

depositBtn!.addEventListener('click', async () => {
  depositStatusEl!.textContent = 'deposit-pending';
  try {
    const cfg = await loadDeployed();
    const account = await getAccount();
    const walletClient = getWalletClient();
    const hash = await walletClient.writeContract({
      account,
      address: cfg.vaultAddress,
      abi: vaultAbi,
      functionName: 'deposit',
      args: [DEPOSIT_AMOUNT],
    });
    depositStatusEl!.textContent = `deposit-tx:${hash}`;
  } catch (err) {
    depositStatusEl!.textContent = `error: ${(err as Error)?.message ?? String(err)}`;
    throw err;
  }
});

permitSignBtn!.addEventListener('click', async () => {
  depositStatusEl!.textContent = 'permit-sign-pending';
  try {
    const cfg = await loadDeployed();
    const account = await getAccount();
    if (!window.ethereum) throw new Error('No injected wallet');
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: custom(window.ethereum),
    });
    const walletClient = getWalletClient();
    const nonce = await publicClient.readContract({
      address: cfg.tokenAddress,
      abi: tokenAbi,
      functionName: 'nonces',
      args: [account],
    });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = (await walletClient.signTypedData({
      account,
      domain: {
        name: cfg.tokenName,
        version: '1',
        chainId: cfg.chainId,
        verifyingContract: cfg.tokenAddress,
      },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: account,
        spender: cfg.vaultAddress,
        value: DEPOSIT_AMOUNT,
        nonce,
        deadline,
      },
    })) as `0x${string}`;
    permitSignature = { signature, deadline };
    depositStatusEl!.textContent = 'permit-signed';
  } catch (err) {
    depositStatusEl!.textContent = `error: ${(err as Error)?.message ?? String(err)}`;
    throw err;
  }
});

permitSubmitBtn!.addEventListener('click', async () => {
  if (!permitSignature) {
    depositStatusEl!.textContent = 'error: sign permit first';
    return;
  }
  depositStatusEl!.textContent = 'permit-deposit-pending';
  try {
    const cfg = await loadDeployed();
    const account = await getAccount();
    const walletClient = getWalletClient();
    const { v, r, s } = hexToSignature(permitSignature.signature);
    const hash = await walletClient.writeContract({
      account,
      address: cfg.vaultAddress,
      abi: vaultAbi,
      functionName: 'depositWithPermit',
      args: [DEPOSIT_AMOUNT, permitSignature.deadline, Number(v), r, s],
    });
    depositStatusEl!.textContent = `permit-deposit-tx:${hash}`;
  } catch (err) {
    depositStatusEl!.textContent = `error: ${(err as Error)?.message ?? String(err)}`;
    throw err;
  }
});
