#!/usr/bin/env bash
# Downloads the pinned official MetaMask production extension into wallets/metamask/dist.
#
# Idempotent only when the existing artifact is exactly the supported version. A stale or moving
# artifact is replaced so a package build can never silently exercise a different MetaMask UI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
METAMASK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$METAMASK_DIR/dist"
EXPECTED_VERSION="13.13.1"

if [ -f "$DIST_DIR/manifest.json" ]; then
  INSTALLED_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$DIST_DIR/manifest.json")"
  if [ "$INSTALLED_VERSION" = "$EXPECTED_VERSION" ]; then
    echo "[build-extension] MetaMask $EXPECTED_VERSION already exists at $DIST_DIR — skipping."
    exit 0
  fi
  echo "[build-extension] Replacing MetaMask $INSTALLED_VERSION with pinned $EXPECTED_VERSION."
fi

node "$SCRIPT_DIR/download-test-build.mjs" "$DIST_DIR"

INSTALLED_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$DIST_DIR/manifest.json")"
if [ "$INSTALLED_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "[build-extension] ERROR: expected MetaMask $EXPECTED_VERSION, found $INSTALLED_VERSION." >&2
  exit 1
fi

echo "[build-extension] Done — MetaMask $INSTALLED_VERSION at $DIST_DIR"
