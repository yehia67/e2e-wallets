# Repository rules

## Public documentation is package-consumer documentation

- Every user-facing README, tutorial, skill example, and example-package README must teach use of
  the published `@wallets-e2e/core`, `@wallets-e2e/metamask`, and `@wallets-e2e/leather` entrypoints.
- Consumer examples must install packages with npm, pnpm, or yarn and import only public package
  exports. Never tell users to import from this repository's `src` directories, use `workspace:*`,
  link local packages, run repository-only build scripts, or copy toolkit implementation files.
- Wallet browser artifacts are separate from the JavaScript packages. Put unpacked extensions in a
  caller-owned, gitignored path such as `.wallet-extensions/<wallet-version>` and document a pinned,
  verifiable acquisition method.
- If the registry does not contain a mutually compatible release, say that package consumption is
  blocked pending publication. Never disguise a source checkout or monorepo command as package use.
- Validate package examples against installed or packed package exports, not against TypeScript
  source files that may not have been published.
- `CONTRIBUTING.md` is the only documentation allowed to contain maintainer-only monorepo setup and
  workspace commands. Label those instructions as contributor workflows, never consumer setup.

## Git safety

Agents must never perform Git writes in this repository: no add, commit, amend, branch, checkout,
switch, merge, rebase, reset, restore, stash, tag, push, pull, fetch, cherry-pick, revert, clean,
worktree mutation, or configuration write. Read-only Git inspection is allowed.
