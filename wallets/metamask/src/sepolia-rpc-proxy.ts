/**
 * Local HTTP JSON-RPC proxy for MetaMask.
 *
 * MetaMask's test build ships with Infura project id `000…0` → Sepolia calls return
 * Unauthorized. Adding a public HTTPS RPC in the UI often fails with
 * "Could not fetch chain ID" from the extension. MetaMask *does* allow
 * `http://127.0.0.1` RPCs, so we proxy localhost → a working public Sepolia endpoint.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveWorkingSepoliaRpc } from '@wallets-e2e/core';

let proxyUrl: string | null = null;
let server: http.Server | null = null;
let upstreamRpc = '';

async function forward(body: string): Promise<{ status: number; body: string }> {
  const response = await fetch(upstreamRpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.text() };
}

/**
 * Starts (once) a localhost proxy and returns its RPC URL for MetaMask network config.
 */
export async function getMetaMaskSepoliaRpcUrl(): Promise<string> {
  if (proxyUrl) return proxyUrl;

  upstreamRpc = await resolveWorkingSepoliaRpc();

  server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const payload = Buffer.concat(chunks).toString('utf8') || '{}';
      void forward(payload)
        .then(({ status, body }) => {
          res.writeHead(status, {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          });
          res.end(body);
        })
        .catch((error: Error) => {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32000, message: `sepolia proxy upstream failed: ${error.message}` },
            }),
          );
        });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => resolve());
  });

  const { port } = server.address() as AddressInfo;
  proxyUrl = `http://127.0.0.1:${port}`;
  return proxyUrl;
}

export function sepoliaRpcProxyUpstream(): string {
  return upstreamRpc;
}
