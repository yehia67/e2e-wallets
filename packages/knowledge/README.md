# @wallets-e2e/knowledge

Agent-facing guides for driving real MetaMask and Leather extensions in Playwright. This is the
single source of truth shared by:

- the [`@wallets-e2e/mcp`](https://www.npmjs.com/package/@wallets-e2e/mcp) server (`list_guides` /
  `get_guide`)
- the Claude skill (`SKILL.md` plus `references/`)

You typically do not import this package from application code. Install it when you want the skill
files on disk:

```bash
npm install -D @wallets-e2e/knowledge
mkdir -p .claude/skills/wallets-e2e
cp node_modules/@wallets-e2e/knowledge/SKILL.md .claude/skills/wallets-e2e/
cp -R node_modules/@wallets-e2e/knowledge/references .claude/skills/wallets-e2e/
```

Agents that already have the MCP server connected get the same text from `get_guide` and do not need
this copy.

## License

MIT
