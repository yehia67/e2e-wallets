import { useState } from 'react';
import { connect, disconnect, isConnected, request } from '@stacks/connect';

// Any syntactically valid testnet-form address works as a transfer recipient -- it doesn't need
// to be funded. Reused from this repo's own Clarinet-devnet-era well-known accounts.
const TRANSFER_RECIPIENT = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';

// contracts/counter.clar, deployed to real testnet by scripts/deploy-counter-testnet.mjs from
// this repo's fixture wallet -- a real smart-contract interaction, not just a plain STX transfer.
const COUNTER_CONTRACT = 'ST1QM4Q2BM7SXWTECDSJB7SAEBMQQN741F32V9N05.counter';

/**
 * The minimal target this repo's tests point a browser at: one "Connect Wallet" button, real
 * `@stacks/connect` underneath, nothing mocked. Once connected, a "Sign Message" button appears —
 * a natural next step for a real wallet-connected app, not a second connect flow. Both drive real
 * extension popups; `WalletDriver#connectToDapp`/`#confirmTransaction` in `wallets/leather` are
 * what automate approving them (see `tutorials/quick-start.md`).
 */
export function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [contractCallTxid, setContractCallTxid] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    try {
      const response = await connect();
      // Leather returns multiple addresses — two Bitcoin formats (p2wpkh, p2tr) plus one Stacks
      // address, all in the same array with no guaranteed order. Verified by inspection: naively
      // taking addresses[0] silently picks a Bitcoin address instead. This app is Stacks-only, so
      // find the STX entry explicitly.
      const stxAddress = response.addresses.find((a) => a.symbol === 'STX')?.address ?? null;
      setAddress(stxAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSignMessage() {
    setError(null);
    try {
      // `signMessage()` from @stacks/connect is deprecated (a no-op — "Tokens are not needed for
      // latest RPC endpoints"). The real, current way is the generic `request()` RPC call.
      const result = await request('stx_signMessage', { message: 'Hello from wallets-e2e' });
      setSignature(result.signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSendStx() {
    setError(null);
    try {
      const result = await request('stx_transferStx', {
        recipient: TRANSFER_RECIPIENT,
        amount: 1_000_000, // 1 STX in micro-STX
        memo: 'psw testnet test', // Stacks memo field is a fixed 34-byte buffer -- must stay short
      });
      setTxid(result.txid ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCallContract() {
    setError(null);
    try {
      // A real smart-contract interaction, not a plain STX transfer -- the more representative
      // dapp use case. `increment` takes no arguments, so `functionArgs` is empty.
      const result = await request('stx_callContract', {
        contract: COUNTER_CONTRACT,
        functionName: 'increment',
        functionArgs: [],
      });
      setContractCallTxid(result.txid ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDisconnect() {
    disconnect();
    setAddress(null);
    setSignature(null);
    setTxid(null);
    setContractCallTxid(null);
  }

  if (address) {
    return (
      <main>
        <p data-testid="connected-address">Connected: {address}</p>
        <button type="button" data-testid="sign-message" onClick={handleSignMessage}>
          Sign Message
        </button>
        {signature && <p data-testid="signature-result">Signature: {signature}</p>}
        <button type="button" data-testid="send-stx" onClick={handleSendStx}>
          Send 1 STX (testnet)
        </button>
        {txid && <p data-testid="transfer-txid">txid: {txid}</p>}
        <button type="button" data-testid="call-contract" onClick={handleCallContract}>
          Call Contract (increment)
        </button>
        {contractCallTxid && <p data-testid="contract-call-txid">txid: {contractCallTxid}</p>}
        <button type="button" onClick={handleDisconnect}>
          Disconnect
        </button>
        {error && <p data-testid="connect-error">{error}</p>}
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
