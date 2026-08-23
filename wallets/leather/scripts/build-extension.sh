#!/usr/bin/env bash
# Builds the real Leather extension from source into wallets/leather/dist.
#
# Idempotent: if wallets/leather/dist already contains a built manifest.json, this is a no-op.
# Delete wallets/leather/dist to force a rebuild.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEATHER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# Cloned/built OUTSIDE the pnpm workspace tree on purpose: leather-io/extension is itself a big
# standalone project with its own dependency tree. If it were cloned inside this repo, pnpm would
# find our root pnpm-workspace.yaml walking up from the clone and silently fold it into *our*
# workspace instead of installing its own deps (that's exactly what happened the first time this
# script ran — `pnpm prepare`'s `panda codegen` failed with "panda: command not found" because no
# node_modules had actually been installed for the clone).
SOURCE_DIR="${TMPDIR:-/tmp}/stacks-wallet-leather-source"
DIST_DIR="$LEATHER_DIR/dist"
REPO_URL="https://github.com/leather-io/extension.git"

if [ -f "$DIST_DIR/manifest.json" ]; then
  echo "[build-extension] Already built at $DIST_DIR — skipping. Delete it to force a rebuild."
  exit 0
fi

echo "[build-extension] Building Leather from source into $DIST_DIR ..."

if [ ! -d "$SOURCE_DIR/.git" ]; then
  echo "[build-extension] Cloning $REPO_URL ..."
  rm -rf "$SOURCE_DIR"
  git clone --depth 1 "$REPO_URL" "$SOURCE_DIR"
fi

pushd "$SOURCE_DIR" >/dev/null
pnpm install
pnpm prepare
pnpm build
popd >/dev/null

if [ ! -f "$SOURCE_DIR/dist/manifest.json" ]; then
  echo "[build-extension] ERROR: build finished but $SOURCE_DIR/dist/manifest.json is missing." >&2
  exit 1
fi

rm -rf "$DIST_DIR"
cp -R "$SOURCE_DIR/dist" "$DIST_DIR"

echo "[build-extension] Done — extension built at $DIST_DIR"
