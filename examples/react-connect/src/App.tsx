import { useState } from 'react';
import { connect, disconnect, isConnected } from '@stacks/connect';

/**
 * The minimal target this repo's tests point a browser at: one "Connect Wallet" button, real
 * `@stacks/connect` underneath, nothing mocked. `connect()` opens the browser wallet extension's
 * own real connection-approval popup — driving that popup automatically is
 * `WalletDriver#connectToDapp`, not yet implemented in `wallets/leather` (see
 * `tutorials/quick-start.md`). This app exists so that method has a real page to test against
 * once it is.
 */
export function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    try {
      const response = await connect();
      setAddress(response.addresses[0]?.address ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDisconnect() {
    disconnect();
    setAddress(null);
  }

  if (address) {
    return (
      <main>
        <p data-testid="connected-address">Connected: {address}</p>
        <button type="button" onClick={handleDisconnect}>
          Disconnect
        </button>
      </main>
    );
  }

  return (
    <main>
      <button type="button" data-testid="connect-wallet" onClick={handleConnect}>
        Connect Wallet
      </button>
      {error && <p data-testid="connect-error">{error}</p>}
      <p>
        {isConnected()
          ? 'A wallet session exists but no address is loaded — refresh.'
          : 'No wallet connected yet.'}
      </p>
    </main>
  );
}
