# @wallets-e2e/mcp

Your coding agent builds the feature. This makes it prove the feature works with a real MetaMask,
and hands you the video for your demo.

![MetaMask driven end to end by an agent](https://raw.githubusercontent.com/yehia67/e2e-wallets/main/docs/metamask-demo-full-flow.gif)

That is a real MetaMask extension being unlocked, connected, and approving a transaction, driven by
an agent and recorded automatically. No mocks. Leather on Stacks works the same way.

## Why

You tell your agent to add a USDC deposit button. It writes the code. Then what?

On its own it cannot check its work against a real wallet, so it writes a test with a mocked
provider, or runs nothing at all, and you find out during the demo.

With this it writes a real Playwright test, drives the actual extension popup, waits for the
transaction to mine, and gives you back a video of it happening.

## What you get after every run

A video of the whole run, showing your dapp and the wallet popup being approved. Drop it straight
into a demo.

Screenshots of every open page when something fails, including the wallet popup itself, so you see
what the extension was showing at the moment it broke.

A trace you can scrub through step by step with `npx playwright show-trace`.

An HTML report holding all of it, opened with `npx playwright show-report`.

Your agent gets these too. Screenshots come back to it as real images, so it can look at the wallet
popup it just drove instead of guessing from a log.

## Say this to your agent

> Add a connect-wallet button, then prove it works with a real MetaMask and give me the video.

It reads the guides, writes the test, runs it, and hands back the report.

## Setup

Get a real MetaMask build. This is the "unpacked extension" the config below asks for.

```bash
curl -L https://github.com/MetaMask/metamask-extension/releases/download/v13.13.1/metamask-chrome-13.13.1.zip -o mm.zip
unzip -q mm.zip -d .wallet-extensions/metamask && rm mm.zip
```

Install the test packages.

```bash
npm i -D @wallets-e2e/core @wallets-e2e/metamask @playwright/test
npx playwright install chromium
```

Make a throwaway wallet. Never use one holding funds, because runs record video of the wallet UI
including seed entry.

Point your agent at the server. Claude Code, Cursor, Windsurf, Zed and Copilot all take this same
shape.

```json
{
  "mcpServers": {
    "wallets-e2e": {
      "command": "npx",
      "args": ["-y", "@wallets-e2e/mcp"],
      "env": {
        "WALLETS_E2E_MCP_ROOT": "/absolute/path/to/your/dapp",
        "METAMASK_EXTENSION_PATH": "/absolute/path/to/your/dapp/.wallet-extensions/metamask",
        "WALLETS_E2E_SEED_PHRASE": "your throwaway 12 words",
        "WALLETS_E2E_ETH_ADDRESS": "0x... matching that seed",
        "WALLETS_E2E_PASSWORD": "any strong password"
      }
    }
  }
}
```

Everything in that `env` block is passed to the Playwright process the server starts, which is what
your test fixture reads.

## What the agent does

It reads the `feature-to-test` guide, which teaches the two rules that separate a real wallet test
from a fake one: queue the dapp click inside the driver callback, and assert on a mined receipt
rather than on the popup closing.

Then it writes the test and calls `start_run`, which returns a run id immediately. A wallet suite
takes minutes and a testnet block can take ten, far longer than a tool call may block.

It polls `get_run` until the run finishes, reading the executed count rather than just pass or fail.
A suite where every test skipped still exits zero, and this reports that as an error instead of a
pass.

Finally it calls `get_report` for the HTML report, the video paths and the screenshots.

## Leather on Stacks

Same flow. Install `@wallets-e2e/leather` instead of `@wallets-e2e/metamask`, build the Leather
extension, and set `LEATHER_EXTENSION_PATH` to it. The guides cover STX transfers, contract calls and
Stacks receipt polling.

## Tools

`list_guides` and `get_guide` explain how to write the test. Start at `feature-to-test`.

`list_projects` finds the Playwright projects under your root and returns an id for each. Every other
tool takes one of those ids, never a path.

`start_run` starts a run and returns immediately. It also accepts `grep`, `testFile` and `headed`.

`get_run` reports the state plus executed, passed, failed, flaky and skipped counts, and the first
failures.

`get_report` returns the HTML report, videos, traces and screenshots.

`get_artifact` returns one artifact. Screenshots come back as images.

`cancel_run` stops a run still in flight.

Only one run happens at a time, because wallet suites drive a persistent browser profile that cannot
be shared.

## Safety

Seed phrases are never tool arguments. They are read from this server's own environment, so they
cannot reach a model's context window or a client's logs.

`start_run` takes project ids, never paths. An absolute path, or one containing `..`, is refused.

Spending gates such as `WALLETS_E2E_RUN_SEPOLIA` are inherited from the environment and cannot be set
per call, so no prompt injection can make an agent spend funds.

Use test wallets only.

## Also available as a Claude skill

The same guides ship as [`@wallets-e2e/knowledge`](https://www.npmjs.com/package/@wallets-e2e/knowledge).
Copy its `SKILL.md` and `references/` into `~/.claude/skills/wallets-e2e/`, or let this server serve
them through `get_guide`.

## Compatibility

Tools only, stdio transport, hand-written JSON Schema, and no dependence on client sampling,
elicitation or roots, so it behaves the same in every MCP client. The server reads your lockfile to
decide whether to invoke Playwright through pnpm, yarn or npm.

## License

MIT
