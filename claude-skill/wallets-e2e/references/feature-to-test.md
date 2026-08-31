# From a finished feature to a passing wallet test

The loop to run **after** you implement a dapp feature and before you call it done. A wallet feature
that has only been reasoned about is not finished; it is finished when a real extension has driven
it and left evidence.

## 1. Name the user-visible flow you just built

Write one sentence in the user's words: *"a visitor connects their wallet and sends 1 STX"*. If you
cannot, the feature is not testable yet — go back to the code.

Then list, from the diff, every point where the dapp hands control to the wallet. Each one is a
popup, and each popup is a step in the test:

| You added | The wallet does |
|---|---|
| a connect button | opens a connection-approval popup |
| a send / swap / mint call | opens a transaction-confirmation popup |
| an EIP-712 / permit signature | opens a signature popup (not a transaction popup) |
| a chain-specific read | nothing, but the wallet must already be on that network |

## 2. Add test ids to what you just built

The test drives your dapp through its own UI. Give every element the flow touches a stable
`data-testid` now, while the code is fresh: the connect button, the action button, and the element
that displays the result (address, transaction id, balance). Selectors based on visible text break
the first time someone rewords a label.

## 3. Write the test

Read the guide for your wallet — `metamask-evm` or `leather-stacks` — and follow its example. The
shape is always the same:

1. import the wallet
2. put it on the right network
3. connect it to your dapp
4. **queue** the dapp click inside the driver's `trigger` callback, never click it yourself
5. assert on your dapp's own rendered result
6. for anything on-chain, poll for the receipt

Step 4 is the one that catches people. The driver starts listening for the popup *before* it runs
your callback; a click made outside that callback opens the popup with nobody listening, and the
test dies on an opaque timeout. `bdd` covers the same rule for Gherkin steps.

## 4. Assert on the chain, not on the popup closing

A closed popup proves the user clicked confirm. It does not prove the transaction was broadcast,
mined, or successful — a reverted transaction closes the popup exactly like a successful one.

Use `waitForTransactionMined` (Stacks) or `waitForEthTransactionMined` (EVM) and assert the returned
status. This is the single most common way a wallet test passes while the feature is broken.

## 5. Run it and collect reviewer evidence

Prefer the `@wallets-e2e/mcp` tools when they are connected. Do not shell out to Playwright if
`list_projects` is available.

1. `list_projects` — pick the id of this dapp's Playwright project.
2. `start_run` with that id, optional `testFile` or `grep` to focus the new coverage. It returns a
   `runId` immediately. A testnet confirmation can take ~10 minutes; poll, do not block.
3. Poll `get_run` until `state` is not `running`. Read `executed`. Zero executed is a failure even
   when the process exited 0 (the usual cause is an unbuilt extension).
4. `get_report` on **every** finished run, pass or fail. It returns the HTML report, every video,
   every screenshot, every trace, and embeds representative screenshots so the reviewer can see the
   wallet popup here.
5. `get_artifact` for any extra screenshot worth showing. Point the reviewer at the video paths and
   HTML report for the full end-to-end transaction.

If MCP is not connected, ask the user to add `npx -y @wallets-e2e/mcp` with `WALLETS_E2E_MCP_ROOT`
set to this dapp, then fall back to:

```bash
npx playwright test
npx playwright show-report
```

A pass without video of the wallet or dapp is incomplete evidence. The reviewer must be able to
watch the real popups and on-chain flow.

`setup-and-reporting` covers the artifact configuration; `troubleshooting` maps common symptoms to
causes.

## 6. Fix, and re-run the same test

Change one thing at a time and re-run. A wallet test that passes only sometimes is a real finding
about your dapp, not noise to retry away: races between the dapp's state and the wallet's, or an
assertion that fires before the chain has caught up, are genuine bugs your users will hit.

## Definition of done

- [ ] Every popup the feature opens is exercised by a test.
- [ ] Every on-chain effect is asserted from a receipt, not from the popup closing.
- [ ] The run reports a non-zero `executed` count.
- [ ] The reviewer has the HTML report, at least one video of the dapp or wallet, and representative
      screenshots (wallet confirmation + dapp result).
- [ ] The failure path was seen at least once — force a failure and confirm the report shows it,
      so you know the test can actually fail.
- [ ] No secret is hardcoded; the seed comes from the environment.
