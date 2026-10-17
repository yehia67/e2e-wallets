#!/usr/bin/env bash
# Verify the workspace end to end and, only when every gate passed, publish the packages.
#
#   scripts/release.sh            # every gate + pack + tarball checks; prints the publish commands
#   scripts/release.sh --publish  # the same, then `npm publish` each tarball in dependency order
#   scripts/release.sh --quick    # unit tests and typecheck only: for iterating, never for a release
#   scripts/release.sh --skip-gates [--publish]
#                                 # pack, check and publish only: right after a full run passed in
#                                 # this same checkout and nothing changed since
#
# Every example suite runs for real — both wallet extensions are built, the fixture wallet comes
# from the environment or the root .env files, and a skipped test fails the gate: a run that skipped
# proves nothing. The suites spend testnet funds (Stacks testnet STX, Sepolia ETH) and take minutes.
# Needs: pnpm 9, Node >= 22.18, Playwright Chromium (`pnpm exec playwright install chromium`),
# FFmpeg with libx264 and libvpx, ffprobe, git (Leather is built from source), and `npm login` for
# --publish.
set -euo pipefail

cd "$(dirname "$0")/.."
PUBLISH=0
QUICK=0
SKIP_GATES=0
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --quick) QUICK=1 ;;
    --skip-gates) SKIP_GATES=1 ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
if [ "$PUBLISH" -eq 1 ] && [ "$QUICK" -eq 1 ]; then
  echo "--quick skips the example suites and the recording check; it cannot publish." >&2; exit 2
fi

# Publish order: each package only depends on the ones before it.
PACKAGES=(core metamask evidence knowledge mcp)
# Plain functions rather than associative arrays: macOS ships bash 3.2.
dir_of() {
  case "$1" in
    core) echo packages/core ;; metamask) echo wallets/metamask ;; evidence) echo packages/evidence ;;
    knowledge) echo packages/knowledge ;; mcp) echo packages/mcp ;;
    *) fail "unknown package $1" ;;
  esac
}

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }
version() { node -e "console.log(require('./$(dir_of "$1")/package.json').version)"; }

step "Toolchain"
command -v pnpm >/dev/null || fail "pnpm is not installed"
command -v ffmpeg >/dev/null || fail "ffmpeg is not on PATH"
command -v ffprobe >/dev/null || fail "ffprobe is not on PATH"
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264 || fail "ffmpeg lacks libx264 (needed by the default video source)"
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libvpx || fail "ffmpeg lacks libvpx (needed by videoSource: 'chromium')"
node -e "const [m]=process.versions.node.split('.').map(Number); if (m<22) process.exit(1)" || fail "Node >= 22.18 required (have $(node -v))"
if [ -n "$(git status --porcelain)" ]; then
  echo "note: the working tree has uncommitted changes; the tarballs are built from the files on disk."
fi
if [ "$PUBLISH" -eq 1 ]; then
  # Checked before the long gate, not after it.
  npm whoami >/dev/null 2>&1 || fail "not logged in to npm (run: npm login, then npm whoami)"
  echo "npm user: $(npm whoami)"
fi

if [ "$SKIP_GATES" -eq 1 ]; then
  printf '\n\033[33m--skip-gates: trusting the last full run of this checkout; only pack, checks and publish.\033[0m\n'
  step "Build"
  pnpm build
else

step "Install (workspace links, lockfile)"
pnpm install --frozen-lockfile=false

step "Build"
pnpm build

step "Typecheck"
for pkg in "${PACKAGES[@]}"; do
  pnpm --filter "@wallets-e2e/$pkg" typecheck
done

step "Unit tests (packages and wallet adapters)"
pnpm exec turbo run test --filter='./packages/*' --filter='./wallets/*'

if [ "$QUICK" -eq 1 ]; then
  printf '\n\033[33m--quick: extension builds, example suites and the recording check were NOT run. Not a release gate.\033[0m\n'
  exit 0
fi

step "Recording integration check (Chromium + FFmpeg, ~3 min)"
node packages/core/scripts/check-recording.mjs

step "Wallet extensions"
pnpm build:leather
pnpm build:metamask
[ -f wallets/leather/dist/manifest.json ] || fail "Leather did not build into wallets/leather/dist"
[ -f wallets/metamask/dist/manifest.json ] || fail "MetaMask did not land in wallets/metamask/dist"

step "Fixture wallet environment"
# The same loader the adapters use: .env.wallet-e2e.local, .env.wallet-e2e, .env.local from here
# upwards, never overwriting what the environment already has.
MISSING="$(node --input-type=module -e "
  import { loadEnvFiles } from './packages/core/dist/env.js';
  loadEnvFiles({ cwd: process.cwd() });
  const needed = ['WALLETS_E2E_SEED_PHRASE', 'WALLETS_E2E_PASSWORD', 'WALLETS_E2E_ETH_ADDRESS',
    'WALLETS_E2E_TESTNET_ADDRESS', 'WALLETS_E2E_MAINNET_ADDRESS'];
  console.log(needed.filter((name) => !process.env[name]?.trim()).join(' '));
")"
[ -z "$MISSING" ] || fail "fixture wallet variables not set (environment or root .env files): $MISSING"
echo "ok: fixture wallet variables present (values not shown)"

step "Example suites (real wallets, real testnets; a skipped test fails the gate)"
EXAMPLES="$(mktemp -d "${TMPDIR:-/tmp}/wallets-e2e-examples.XXXXXX")"
for dir in examples/*/; do
  name="$(basename "$dir")"
  printf '\n-- %s\n' "$name"
  (
    cd "$dir"
    # BDD examples generate their specs first, as their own `test` script does.
    if node -e "process.exit(/bddgen/.test(require('./package.json').scripts.test) ? 0 : 1)"; then
      pnpm exec bddgen
    fi
    PLAYWRIGHT_JSON_OUTPUT_NAME="$EXAMPLES/$name.json" pnpm exec playwright test --reporter=list,json
  ) || true
  node -e "
    const fs = require('fs');
    const file = '$EXAMPLES/$name.json';
    if (!fs.existsSync(file)) { console.error('no JSON report: the run did not start'); process.exit(1); }
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = report.stats;
    const titles = (status) => {
      const out = [];
      const walk = (suite, path) => {
        for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
          const last = test.results.at(-1);
          if (test.status === status || (status === 'skipped' && (!last || last.status === 'skipped'))) out.push([...path, spec.title].join(' > '));
        }
        for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
      };
      for (const suite of report.suites ?? []) walk(suite, [suite.title]);
      return out;
    };
    const problems = [];
    if ((s.expected ?? 0) === 0) problems.push('nothing executed');
    if (s.unexpected) problems.push(s.unexpected + ' failed: ' + titles('unexpected').join('; '));
    if (s.flaky) problems.push(s.flaky + ' flaky: ' + titles('flaky').join('; '));
    if (s.skipped) problems.push(s.skipped + ' skipped: ' + titles('skipped').join('; '));
    if (report.errors?.length) problems.push(report.errors.length + ' runner error(s): ' + report.errors.map((e) => e.message?.split('\\n')[0]).join('; '));
    if (problems.length) { console.error('$name: ' + problems.join(' | ')); process.exit(1); }
    console.log('ok: $name — ' + s.expected + ' passed, 0 skipped, 0 failed');
  " || fail "example suite $name did not fully pass (see above)"
done

step "Regenerate the Claude skill"
pnpm build:skill
if [ -n "$(git status --porcelain claude-skill)" ]; then
  echo "note: claude-skill/ changed; commit it with the release."
fi

fi # SKIP_GATES

step "Pack"
DEST="$(mktemp -d "${TMPDIR:-/tmp}/wallets-e2e-release.XXXXXX")"
tarball() { echo "$DEST/wallets-e2e-$1-$(version "$1").tgz"; }
for pkg in "${PACKAGES[@]}"; do
  # `pnpm pack` takes no --filter (pnpm 9: "Unknown option: 'recursive'"); run it in the package.
  (cd "$(dir_of "$pkg")" && pnpm pack --pack-destination "$DEST" >/dev/null)
  [ -f "$(tarball "$pkg")" ] || fail "expected tarball $(tarball "$pkg") was not produced"
done

step "Tarball dependency ranges"
dep_of() { tar -xzOf "$1" package/package.json | node -e "
  const pkg = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  console.log(all['$2'] ?? '');"; }
expect_dep() {
  local range; range="$(dep_of "$(tarball "$1")" "@wallets-e2e/$2")"
  [[ "$range" == "^$(version "$2")" || "$range" == ">=$(version "$2")"* ]] \
    || fail "$1 tarball depends on @wallets-e2e/$2 '$range', expected ^$(version "$2") (workspace: specifier not rewritten?)"
  echo "ok: $1 -> @wallets-e2e/$2 $range"
}
expect_dep metamask core
expect_dep mcp knowledge
expect_dep mcp evidence
if tar -tzf "$(tarball metamask)" | grep -q '^package/dist/'; then fail "metamask tarball ships the extension build (dist/); check its files list"; fi
tar -tzf "$(tarball core)" | grep -q 'package/dist/index.js' || fail "core tarball has no dist/index.js"
tar -tzf "$(tarball evidence)" | grep -q 'package/dist/cli.js' || fail "evidence tarball has no dist/cli.js"

step "Registry state"
for pkg in "${PACKAGES[@]}"; do
  v="$(version "$pkg")"
  if npm view "@wallets-e2e/$pkg@$v" version >/dev/null 2>&1; then
    echo "already published: @wallets-e2e/$pkg@$v (will be skipped)"
  else
    echo "to publish:        @wallets-e2e/$pkg@$v"
  fi
done

printf '\n\033[32mAll gates passed.\033[0m Tarballs in %s\n' "$DEST"

if [ "$PUBLISH" -ne 1 ]; then
  echo
  echo "Publish them yourself, in this order, or re-run with --publish:"
  for pkg in "${PACKAGES[@]}"; do
    echo "  npm publish $(tarball "$pkg") --access public"
  done
  exit 0
fi

step "Publish"
npm whoami >/dev/null 2>&1 || fail "not logged in to npm (run: npm login)"
for pkg in "${PACKAGES[@]}"; do
  v="$(version "$pkg")"
  if npm view "@wallets-e2e/$pkg@$v" version >/dev/null 2>&1; then
    echo "skip @wallets-e2e/$pkg@$v: already on the registry"
    continue
  fi
  npm publish "$(tarball "$pkg")" --access public
  # Wait until the registry serves it, so the next package's dependency resolves.
  for _ in $(seq 1 30); do
    npm view "@wallets-e2e/$pkg@$v" version >/dev/null 2>&1 && break
    sleep 5
  done
done
printf '\n\033[32mPublished.\033[0m Now: git tag/commit the release, and switch T-REX-Dapp from file: links back to the registry versions.\n'
