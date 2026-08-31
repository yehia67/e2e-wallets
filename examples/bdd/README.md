# Leather BDD package example

This fixture demonstrates the public `@wallets-e2e/core/bdd` and `@wallets-e2e/leather` APIs against
a real dapp and Leather extension. It is repository validation, not a consumer installation path.

In your dapp, install published packages:

```bash
npm install --save-dev @wallets-e2e/core @wallets-e2e/leather @playwright/test playwright-bdd
npx playwright install chromium
```

Your project supplies its own unpacked Leather extension path, dapp server, selectors, feature files,
and environment-backed wallet. Toolkit imports must resolve from the packages above, never from this
repository's source tree.

The key integration rule is unchanged: a dapp action that opens a wallet popup must be queued with
`queueWalletTrigger` and executed inside the driver's `trigger` callback. Clicking before the driver
starts listening creates a popup race and a timeout.

Use the [package-consumer Gherkin tutorial](../../tutorials/feature-files.md) for the complete config,
fixture, step registration, transaction receipt, report, and CI setup. Repository maintainers should
use [CONTRIBUTING.md](../../CONTRIBUTING.md) for internal workspace commands.
