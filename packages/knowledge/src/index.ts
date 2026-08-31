import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Guide {
  id: string;
  title: string;
  /** When an agent should read this guide, phrased so a model can route on it. */
  when: string;
  file: string;
}

/**
 * The routing table every consumer shares. `when` is written for a model deciding which guide to
 * open, so keep it task-shaped ("you are about to…"), not topic-shaped.
 */
export const GUIDES: readonly Guide[] = [
  {
    id: 'overview',
    title: 'Wallet dapp E2E testing — start here',
    when: 'First contact with this toolkit, or you need to decide which other guide applies.',
    file: 'SKILL.md',
  },
  {
    id: 'feature-to-test',
    title: 'From a finished feature to a passing wallet test',
    when: 'You just implemented or changed a dapp feature (connect, transfer, swap, USDC deposit, contract call, signature) and must prove it with a real-wallet E2E test plus video/screenshot artifacts for a reviewer. Read this before writing the test — it is the workflow the other guides plug into, including the MCP run loop.',
    file: 'references/feature-to-test.md',
  },
  {
    id: 'setup-and-reporting',
    title: 'Setup, fixtures and reporting',
    when: 'Installing the packages, preparing an unpacked extension, wiring the test fixture, or configuring HTML report / video / trace / screenshot artifacts.',
    file: 'references/setup-and-reporting.md',
  },
  {
    id: 'package-consumer-examples',
    title: 'Package consumer examples',
    when: 'Writing tests in your own application against the published npm packages. Start here for a normal consuming project.',
    file: 'references/package-consumer-examples.md',
  },
  {
    id: 'metamask-evm',
    title: 'MetaMask and EVM flows',
    when: 'Driving MetaMask: import, network switching, custom networks, connection, ETH transfers, ERC20 approve/deposit, EIP-2612 permit, contract reads and writes.',
    file: 'references/metamask-evm.md',
  },
  {
    id: 'leather-stacks',
    title: 'Leather and Stacks flows',
    when: 'Driving Leather: import, testnet switching, connection, message signing, STX transfers, contract calls, receipt polling.',
    file: 'references/leather-stacks.md',
  },
  {
    id: 'bdd',
    title: 'Gherkin and playwright-bdd',
    when: 'Expressing scenarios as .feature files, wiring createWalletSteps, or writing your own dapp steps.',
    file: 'references/bdd.md',
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    when: 'A run hangs, a popup never appears, an RPC demands credentials, artifacts are missing, or a transaction fails.',
    file: 'references/troubleshooting.md',
  },
];

/**
 * Resolved at runtime rather than baked in: the markdown sits beside `dist/` when installed from
 * npm and beside `src/` when read from a checkout, so the loader walks up to whichever contains it.
 */
export function knowledgeRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, 'SKILL.md'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('[@wallets-e2e/knowledge] Could not locate the guide files relative to this module.');
}

export function guidePath(id: string): string {
  const guide = GUIDES.find((candidate) => candidate.id === id);
  if (!guide) {
    throw new Error(
      `[@wallets-e2e/knowledge] Unknown guide "${id}". Known ids: ${GUIDES.map((g) => g.id).join(', ')}`,
    );
  }
  return resolve(knowledgeRoot(), guide.file);
}

export function readGuide(id: string): string {
  return readFileSync(guidePath(id), 'utf8');
}
