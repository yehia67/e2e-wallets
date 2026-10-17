import { loadEnvFiles } from '@wallets-e2e/core';

/**
 * `.env.wallet-e2e.local`, `.env.wallet-e2e` and `.env.local`, searched from the working directory
 * upwards, so a repository that keeps wallet secrets out of its app's own `.env.local` needs
 * neither a `--env-file` flag nor a wrapper script. A variable the environment already carries —
 * even an empty one — is never overwritten, and an empty `KEY=` line in a file sets nothing.
 */
loadEnvFiles();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[wallets/metamask] ${name} is not set. Generate a throwaway wallet and export ` +
        `WALLETS_E2E_SEED_PHRASE, WALLETS_E2E_ETH_ADDRESS and WALLETS_E2E_PASSWORD ` +
        `(a .env.wallet-e2e.local or .env.local beside your tests is auto-loaded).`,
    );
  }
  return value;
}

/**
 * Getters, not values: `src/onboarding.ts` imports this module, so eager reads would make
 * `import '@wallets-e2e/metamask'` throw for any consumer without the env set — before a test runs.
 */
export const wallet = {
  get seedPhrase(): string {
    return requireEnv('WALLETS_E2E_SEED_PHRASE');
  },
  get address(): string {
    return requireEnv('WALLETS_E2E_ETH_ADDRESS');
  },
  get password(): string {
    return requireEnv('WALLETS_E2E_PASSWORD');
  },
};
