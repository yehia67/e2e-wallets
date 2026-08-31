# @wallets-e2e/mcp

An [MCP](https://modelcontextprotocol.io) server that lets **any** MCP-capable agent run real wallet
E2E suites and read back what happened: start a run, poll it, fetch its video / trace / screenshots.

Deliberately built to the portable subset of the protocol — tools only, stdio transport,
hand-written JSON Schema, no dependence on client sampling, elicitation or roots. It works the same
in Claude Code, Cursor, Windsurf, Zed, Continue, a Copilot agent, or your own client.

## Install

Not published yet. Until it is, build it and point your client at the local entry point:

```bash
pnpm --filter @wallets-e2e/mcp build
# then use: "command": "node", "args": ["/abs/path/packages/mcp/dist/index.js"]
```

Once published, the same config works everywhere via `npx -y @wallets-e2e/mcp`. Every client takes
the same command/args/env shape:

```json
{
  "mcpServers": {
    "wallets-e2e": {
      "command": "npx",
      "args": ["-y", "@wallets-e2e/mcp"],
      "env": {
        "WALLETS_E2E_MCP_ROOT": "/path/to/your/repo",
        "WALLETS_E2E_SEED_PHRASE": "your throwaway test wallet",
        "WALLETS_E2E_ETH_ADDRESS": "0x...",
        "WALLETS_E2E_PASSWORD": "..."
      }
    }
  }
}
```

Config comes only from environment variables and CLI flags — there is no client-specific config file.

## Tools

| Tool | Purpose |
|---|---|
| `list_projects` | Discovers runnable Playwright projects under the root. Returns an **id** per project. |
| `start_run` | Starts a run, returns a `runId` **immediately**. Takes `project` (an id), optional `grep`, `testFile`, `headed`. |
| `get_run` | State plus `executed / passed / failed / flaky / skipped` counts and the first failures. |
| `get_report` | HTML report directory and every attachment path (video, trace, screenshot). |
| `cancel_run` | Stops a run still in flight. |

## Why runs are asynchronous

A real wallet suite takes minutes; a Stacks or Sepolia block alone is ~10 minutes. That is far longer
than an MCP tool call can block in most clients, so there is no `run_tests` tool. `start_run` returns
a handle and the agent polls `get_run`.

Only one run is allowed at a time. Wallet suites drive a persistent browser profile that cannot be
shared, and their configs pin `workers: 1`; a second concurrent run would corrupt the first.

## Reporting honesty

`get_run` reports `executed`, not just pass/fail. A Playwright suite in which **every test skipped
still exits 0** — the usual cause being an unbuilt wallet extension. This server reports a run that
executed nothing as `error`, with a note saying so, rather than letting an agent call it a success.

## Secrets and spending

- **Seed phrases are never tool arguments.** They are read from this server's own environment, so
  they cannot reach a model's context window or a client's request logs. No tool accepts one.
- **Project ids, never paths.** `start_run` takes an id from `list_projects`. An absolute path or one
  containing `..` is refused, so no argument from a model can point the runner elsewhere.
- **Spending gates stay server-side.** Flags such as `WALLETS_E2E_RUN_SEPOLIA` are inherited from the
  environment and are not settable per call, so no prompt injection can make an agent spend funds.
- Test wallets only. Never point this at a wallet holding anything of value: runs record video of the
  wallet UI, seed-phrase entry included.

## Development

```bash
pnpm --filter @wallets-e2e/mcp build
pnpm --filter @wallets-e2e/mcp typecheck
pnpm --filter @wallets-e2e/mcp inspect   # MCP Inspector, client-agnostic
```

## License

MIT
