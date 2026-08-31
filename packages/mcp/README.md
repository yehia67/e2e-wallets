# @wallets-e2e/mcp

An [MCP](https://modelcontextprotocol.io) server that any coding agent can use to **prove a dapp
feature with a real wallet**. After the agent implements the frontend and contracts — a USDC
deposit, a connect button, a swap, a contract call — it writes a Playwright test against the real
MetaMask or Leather extension, runs it here, and hands the reviewer video plus screenshots of the
actual popups and mined transactions.

Works the same in Claude Code, Cursor, Windsurf, Zed, Continue, a Copilot agent, or your own client:
tools only, stdio transport, hand-written JSON Schema, no dependence on client sampling, elicitation,
or roots.

## Install

Every client takes the same command/args/env shape. Config comes only from environment variables:

```json
{
  "mcpServers": {
    "wallets-e2e": {
      "command": "npx",
      "args": ["-y", "@wallets-e2e/mcp"],
      "env": {
        "WALLETS_E2E_MCP_ROOT": "/path/to/the/dapp/repo",
        "WALLETS_E2E_SEED_PHRASE": "your throwaway test wallet",
        "WALLETS_E2E_ETH_ADDRESS": "0x...",
        "WALLETS_E2E_PASSWORD": "..."
      }
    }
  }
}
```

`WALLETS_E2E_MCP_ROOT` is the directory the server scans for Playwright projects. Set it to the dapp
repository the agent is working in. It defaults to the process working directory, which is rarely
what you want from a client.

The wallet variables are consumed by the suites the server runs, not by the server itself. Seed
phrases are never tool arguments.

The dapp also needs the published test packages (`@wallets-e2e/core` plus `@wallets-e2e/metamask` or
`@wallets-e2e/leather`) and an unpacked wallet extension. See
[`@wallets-e2e/core`](https://www.npmjs.com/package/@wallets-e2e/core).

## What an agent does with this

1. Implement the feature (UI, contracts, whatever the user asked for).
2. `get_guide` `feature-to-test`, then the wallet guide, and write a real-extension Playwright test.
3. `list_projects` → `start_run` (returns a `runId` immediately; a testnet tx can take ~10 minutes).
4. Poll `get_run` until it finishes. `executed=0` is a failure, even if the process exited 0.
5. `get_report` on **every** finished run, pass or fail. It returns the HTML report, every video and
   screenshot path, and embeds representative screenshots so the reviewer can see the wallet UI here.
6. Hand the video paths and HTML report to the reviewer so they can watch the end-to-end
   transactions.

The same guides are also a Claude skill, shipped as [`@wallets-e2e/knowledge`](https://www.npmjs.com/package/@wallets-e2e/knowledge). Copy its `SKILL.md` and `references/` into `.claude/skills/wallets-e2e`, or let the MCP serve them via `get_guide`.

## Tools

| Tool | Purpose |
|---|---|
| `list_guides` | Catalog of how-to-write-the-test guides. Start at `feature-to-test`. |
| `get_guide` | Full text of one guide. |
| `list_projects` | Discovers runnable Playwright projects under the root. Returns an **id** per project. |
| `start_run` | Starts a run, returns a `runId` **immediately**. Takes `project` (an id), optional `grep`, `testFile`, `headed`. |
| `get_run` | State plus `executed / passed / failed / flaky / skipped` counts and the first failures. |
| `get_report` | HTML report, videos, screenshots, traces, plus embedded screenshots for the reviewer. |
| `get_artifact` | One artifact by path. Screenshots come back as images; videos stay as paths. |
| `cancel_run` | Stops a run still in flight. |

## Why runs are asynchronous

A real wallet suite takes minutes; a Stacks or Sepolia block alone is ~10 minutes. That is far longer
than an MCP tool call can block in most clients, so there is no `run_tests` tool. `start_run` returns
a handle and the agent polls `get_run`.

Only one run is allowed at a time. Wallet suites drive a persistent browser profile that cannot be
shared, and their configs pin `workers: 1`; a second concurrent run would corrupt the first.

The server detects pnpm, yarn, or npm from the project's lockfile and invokes Playwright through that
package manager.

## Reporting honesty

`get_run` reports `executed`, not just pass/fail. A Playwright suite in which **every test skipped
still exits 0** — the usual cause being an unbuilt wallet extension. This server reports a run that
executed nothing as `error`, with a note saying so, rather than letting an agent call it a success.

A feature is not done until `get_report` has given the reviewer video and screenshots of the real
wallet flow. A green `executed` count without artifacts is incomplete evidence.

## Secrets and spending

- **Seed phrases are never tool arguments.** They are read from this server's own environment, so
  they cannot reach a model's context window or a client's request logs. No tool accepts one.
- **Project ids, never paths.** `start_run` takes an id from `list_projects`. An absolute path or one
  containing `..` is refused, so no argument from a model can point the runner elsewhere. `testFile`
  and `get_artifact` are likewise confined to the chosen project / that run's attachments.
- **Spending gates stay server-side.** Flags such as `WALLETS_E2E_RUN_SEPOLIA` are inherited from the
  environment and are not settable per call, so no prompt injection can make an agent spend funds.
- Test wallets only. Never point this at a wallet holding anything of value: runs record video of the
  wallet UI, seed-phrase entry included.

## License

MIT
