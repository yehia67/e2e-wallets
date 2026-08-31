# Troubleshooting wallet E2E flows

Diagnose from observable state and retained artifacts. Do not add arbitrary sleeps, click guessed
buttons repeatedly, or declare success after skipping the failing test.

## Connection or approval waits forever

First inspect where the dapp trigger runs. It must be inside the driver callback:

```ts
await driver.connectToDapp(context, async () => {
  await page.getByTestId('connect-wallet').click();
});
```

The same applies to transaction, token-permission, and signature actions. A click before the driver
call opens the popup before `waitForEvent('page')` or approval-page discovery is armed, producing a
timeout even though the user saw the popup.

Then inspect the screenshots/video for:

- a second Next/Connect/Confirm stage;
- a disabled button caused by invalid dapp data;
- a network-change prompt preceding connection;
- an already-authorized dapp that legitimately opened no connect popup;
- a popup that reused an existing MetaMask extension page rather than creating a new page;
- a wallet critical-error/recovery page.

Use the driver's high-level action before adding direct wallet selectors. Version-matched driver
logic already handles supported multi-stage MetaMask confirmation and existing approval pages.

## RPC asks for credentials or Sepolia does not connect

- Do not edit built-in Sepolia's RPC by default. Enable test networks and select the bundled chain.
- Do not independently choose a public endpoint for browser receipt polling. Use
  `createInjectedEvmRpc(page)` after connection.
- If an explicit custom/override RPC is required, probe it before opening MetaMask. Reject HTTP
  401/402/403/407/429/451, redirects, HTML/browser challenges, gated JSON-RPC errors, wrong chain
  IDs, missing results, or nodes unable to answer balance and gas-estimation calls.
- Verify `eth_chainId` through the injected provider. Sepolia must be `0xaa36a7`.
- Treat an RPC rejection during receipt polling as a failure, not as a pending receipt.

## Popup never appears

Check the dapp first. A wallet cannot approve a request the dapp never emitted.

- Assert the trigger element is visible and enabled.
- Surface dapp error text immediately.
- Inspect console/network/trace for a rejected provider call.
- Confirm the wallet is unlocked and connected to the requested network.
- For Leather, check transaction construction: a memo over 34 bytes or a mainnet/testnet mismatch
  can fail before wallet UI renders.
- For MetaMask, distinguish ERC20 permission (`approveTokenPermission`) from ordinary transaction
  confirmation and typed signature (`confirmSignature`).

`approveTokenPermission` is not the general smart-contract API. If a mint, swap, stake, vault,
deployment, or other normal contract write is waiting for approval, use `confirmTransaction`. The
dapp must first construct and submit a valid transaction request; the driver only handles the wallet
screen produced by that request.

## Transaction dependency fails

Validate and retain the hash, then poll the correct chain. Do not begin a dependent deposit while an
approval is pending. On EVM, fail on `reverted`; on Stacks, fail on every non-success/`abort_by_*`
status. If the dapp accumulates state across runs, assert a before/after delta rather than a fixed
absolute balance.

## Reports or recordings are missing

- Confirm the config is wrapped in `withWalletReporting` and the test imports the
  `createExtensionTest` fixture rather than Playwright's stock `test`.
- Confirm the context closes; video paths resolve only after close.
- Default reporting retains video and screenshots for both passed and failed cases, with traces on
  unexpected failures. Explicit `use` settings may override those defaults.
- Multiple pages produce multiple screenshots/videos. The primary `video` should be a dapp HTTP(S)
  page or wallet page, not the persistent context's unused `about:blank` page.
- Verify content visually by sampling video frames and opening representative PNGs. A nonzero file
  size does not prove useful content.
- The HTML reporter output is usually `playwright-report/index.html`; generated `test-results`
  contain raw/attached media and traces.

## Extension or environment mismatch

- Check `manifest.json` exists at the configured extension path.
- MetaMask support is version-matched to the pinned official 13.13.1 production artifact. A newer
  CI/test build can change selectors, onboarding, or network behavior.
- Use headed Chromium unless the repository has separately proven extension behavior headlessly.
- Use one worker for shared live-chain fixture accounts unless state isolation is designed and
  funded for parallel runs.
- Ensure the dapp web server is reachable at `baseURL` before diagnosing wallet UI.

## Evidence-first failure report

Report:

1. exact command and environment gate;
2. pass/fail/skip counts and failing assertion;
3. dapp URL and expected chain ID;
4. whether the wallet action opened/reused a page;
5. transaction hash and mined/reverted/aborted/timeout result when applicable;
6. links to HTML report, primary video, representative dapp/wallet screenshots, and trace;
7. what was not run, especially gas-spending tests.

Never replace missing evidence with an assumption that the flow probably works.
