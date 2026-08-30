import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run by `node --test` straight from source, excluded from the build.
import { requireDriver, requireNetworkSwitch, requireSeedPhrase, requireTest } from './guards.ts';
import type { WalletDriver } from '../index.js';
import type { SupportedStacksNetwork } from './networks.ts';

type StacksDriver = WalletDriver<SupportedStacksNetwork>;

describe('requireDriver', () => {
  it('throws immediately when no driver was registered', () => {
    assert.throws(() => requireDriver(undefined));
  });

  it('names the registration function the consumer has to call', () => {
    assert.throws(
      () => requireDriver(undefined),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /createWalletSteps/);
        assert.match(error.message, /driver/);
        return true;
      },
    );
  });

  it('returns the driver untouched when one is registered', () => {
    // Structural stand-in: the guard only checks presence.
    const driver = { importWallet: async () => ({ address: 'ST0' }) } as never;
    assert.equal(requireDriver(driver), driver);
  });
});

describe('requireSeedPhrase', () => {
  it('throws when no seed phrase was supplied', () => {
    assert.throws(() => requireSeedPhrase(undefined));
  });

  it('throws on an empty phrase rather than trying to import nothing', () => {
    assert.throws(() => requireSeedPhrase(''));
  });

  it('throws on a whitespace-only phrase rather than handing blanks to importWallet', () => {
    assert.throws(() => requireSeedPhrase('   \t  '));
  });

  it('points at an environment variable, never an inline key (AD-5)', () => {
    assert.throws(
      () => requireSeedPhrase(undefined),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /createWalletSteps/);
        assert.match(error.message, /environment variable/);
        return true;
      },
    );
  });

  it('returns the trimmed phrase when one is supplied', () => {
    const phrase = 'word '.repeat(24).trim();
    assert.equal(requireSeedPhrase(`  ${phrase}  `), phrase);
  });
});

describe('requireTest', () => {
  it('throws when no test object was passed', () => {
    // createBdd(undefined) is legal: the steps would bind to stock fixtures and time out silently.
    assert.throws(() => requireTest(undefined));
  });

  it('says the test must come from playwright-bdd and carry the extension fixtures', () => {
    assert.throws(
      () => requireTest(undefined),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /createWalletSteps/);
        assert.match(error.message, /playwright-bdd/);
        assert.match(error.message, /extension/);
        return true;
      },
    );
  });

  it('returns the test object untouched when one is passed', () => {
    const test = { describe: () => {} };
    assert.equal(requireTest(test), test);
  });
});

// A driver that cannot switch networks must never be left on mainnet by a "testnet" scenario.
describe('requireNetworkSwitch', () => {
  const driverWithSwitch = {
    importWallet: async () => ({ address: 'ST0' }),
    switchNetwork: async () => {},
    connectToDapp: async () => {},
    confirmTransaction: async () => {},
  } as unknown as StacksDriver;

  const driverWithoutSwitch = {
    importWallet: async () => ({ address: 'ST0' }),
    connectToDapp: async () => {},
    confirmTransaction: async () => {},
  } as unknown as StacksDriver;

  const legacyDriver = {
    importWallet: async () => ({ address: 'ST0' }),
    switchToTestnetNetwork: async () => {},
    connectToDapp: async () => {},
    confirmTransaction: async () => {},
  } as unknown as StacksDriver;

  it('returns the driver switch when a non-mainnet network was asked for', () => {
    assert.equal(typeof requireNetworkSwitch(driverWithSwitch, 'testnet4'), 'function');
  });

  it('falls back to the deprecated testnet switch for compatible drivers', async () => {
    assert.equal(typeof requireNetworkSwitch(legacyDriver, 'testnet4'), 'function');
    await requireNetworkSwitch(legacyDriver, 'testnet4')?.({} as never);
  });

  it('returns nothing for mainnet, where no switch is wanted at all', () => {
    assert.equal(requireNetworkSwitch(driverWithSwitch, 'mainnet'), undefined);
    assert.equal(requireNetworkSwitch(driverWithoutSwitch, 'mainnet'), undefined);
  });

  it('refuses to continue rather than silently leave a testnet scenario on mainnet', () => {
    assert.throws(
      () => requireNetworkSwitch(driverWithoutSwitch, 'testnet4'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /switchNetwork/);
        assert.match(error.message, /mainnet/);
        assert.match(error.message, /testnet4/);
        return true;
      },
    );
  });

  it('calls the switch on the driver, not on a detached function', async () => {
    let receivedThis: unknown;
    const driver = {
      async switchNetwork(this: unknown) {
        receivedThis = this;
      },
    } as unknown as StacksDriver;
    const context = {} as never;
    await requireNetworkSwitch(driver, 'testnet4')?.(context);
    assert.equal(receivedThis, driver);
  });

  it('passes the parsed network through to the driver, not just the context', async () => {
    const received: unknown[] = [];
    const driver = {
      async switchNetwork(context: unknown, network: unknown) {
        received.push(context, network);
      },
    } as unknown as StacksDriver;
    const context = { marker: 'ctx' } as never;
    await requireNetworkSwitch(driver, 'testnet4')?.(context);
    assert.deepEqual(received, [context, 'testnet4']);
  });
});
