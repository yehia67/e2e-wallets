#!/usr/bin/env bash
# Builds the real MetaMask extension (test build) into wallets/metamask/dist.
#
# Idempotent: if wallets/metamask/dist already contains manifest.json, this is a no-op.
# Delete wallets/metamask/dist to force a rebuild.
#
# Strategy (fastest first):
#   1. node scripts/download-test-build.mjs — downloads MetaMask CI test artifact (no clone)
#   2. Clone metamask/metamask-extension outside workspace + yarn download-builds --build-type test
#   3. Fallback: yarn build:test (slow; needs compatible Node for upstream engines)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
METAMASK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="${TMPDIR:-/tmp}/stacks-wallet-metamask-source"
DIST_DIR="$METAMASK_DIR/dist"
REPO_URL="https://github.com/MetaMask/metamask-extension.git"

if [ -f "$DIST_DIR/manifest.json" ]; then
  echo "[build-extension] Already built at $DIST_DIR — skipping. Delete it to force a rebuild."
  exit 0
fi

echo "[build-extension] Building MetaMask test extension into $DIST_DIR ..."

if node "$SCRIPT_DIR/download-test-build.mjs" "$DIST_DIR" 2>/dev/null; then
  if [ -f "$DIST_DIR/manifest.json" ]; then
    echo "[build-extension] Done (CI test artifact download)."
    exit 0
  fi
  # Zip may unpack into a subdirectory — normalize to DIST_DIR root.
  MANIFEST_PATH="$(find "$DIST_DIR" -name manifest.json -not -path '*/firefox/*' 2>/dev/null | head -1 || true)"
  if [ -n "$MANIFEST_PATH" ]; then
    BUILD_ROOT="$(dirname "$MANIFEST_PATH")"
    if [ "$BUILD_ROOT" != "$DIST_DIR" ]; then
      rm -rf "${DIST_DIR}.tmp"
      mv "$BUILD_ROOT" "${DIST_DIR}.tmp"
      rm -rf "$DIST_DIR"
      mv "${DIST_DIR}.tmp" "$DIST_DIR"
    fi
    echo "[build-extension] Done (CI test artifact download)."
    exit 0
  fi
  rm -rf "$DIST_DIR"
  echo "[build-extension] CI download did not produce manifest.json — trying clone path ..."
fi

if [ ! -d "$SOURCE_DIR/.git" ]; then
  echo "[build-extension] Cloning $REPO_URL ..."
  rm -rf "$SOURCE_DIR"
  git clone --depth 1 "$REPO_URL" "$SOURCE_DIR"
fi

pushd "$SOURCE_DIR" >/dev/null
# Upstream may require a newer Node than this repo — ignore engine checks for install only.
if [ -f .yarnrc.yml ]; then
  grep -q 'ignoreEngines' .yarnrc.yml || echo 'ignoreEngines: true' >> .yarnrc.yml
else
  echo 'ignoreEngines: true' > .yarnrc.yml
fi

yarn install --immutable 2>/dev/null || yarn install

if yarn download-builds --build-type test 2>/dev/null; then
  echo "[build-extension] Downloaded official test build via yarn."
else
  echo "[build-extension] download-builds failed — falling back to yarn build:test (slow) ..."
  yarn build:test
fi
popd >/dev/null

MANIFEST_PATH="$(find "$SOURCE_DIR/dist" -name manifest.json -not -path '*/firefox/*' 2>/dev/null | head -1 || true)"
if [ -z "$MANIFEST_PATH" ]; then
  echo "[build-extension] ERROR: build finished but no manifest.json found under $SOURCE_DIR/dist." >&2
  exit 1
fi

BUILD_ROOT="$(dirname "$MANIFEST_PATH")"
rm -rf "$DIST_DIR"
cp -R "$BUILD_ROOT" "$DIST_DIR"

echo "[build-extension] Done — extension built at $DIST_DIR"
