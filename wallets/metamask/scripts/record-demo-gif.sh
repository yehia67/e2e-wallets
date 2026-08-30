#!/usr/bin/env bash
# Record docs/metamask-demo-full-flow.gif only after the FULL spike demo passes:
# unlock → network switch → connect → ETH transfer (mined) → ERC20 approve → deposit (mined).
# Connect-only or partial runs never produce a GIF.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SPIKE="$ROOT/examples/metamask-spike"
DEPLOYED="$SPIKE/deployed.json"
ENV_LOCAL="$ROOT/wallets/metamask/.env.local"

if [[ ! -f "$ENV_LOCAL" ]]; then
  echo "Missing $ENV_LOCAL — run: node wallets/metamask/scripts/generate-fixture-wallet.mjs"
  exit 1
fi
if [[ ! -f "$DEPLOYED" ]]; then
  echo "Missing $DEPLOYED — run:"
  echo "  cd examples/metamask-spike && forge build"
  echo "  node examples/metamask-spike/scripts/deploy.mjs"
  exit 1
fi

# wallets/metamask/fixtures/wallet.ts auto-loads .env.local — do NOT `source` it (seed phrases break bash).

pnpm --filter @wallets-e2e/core build
pnpm --filter @wallets-e2e/metamask build

VIDEO_DIR="$SPIKE/test-results/videos"
rm -f "$VIDEO_DIR"/*.webm 2>/dev/null || true

cd "$SPIKE"
WALLETS_E2E_REQUIRE_EXTENSION=1 WALLETS_E2E_RECORD_DEMO=1 pnpm exec playwright test tests/demo-full-flow.spec.ts

# Full-flow video is the largest recording from this single-session run.
LATEST="$(find "$VIDEO_DIR" -name '*.webm' -type f -print0 2>/dev/null | xargs -0 ls -S 2>/dev/null | head -1)"
if [[ -z "$LATEST" ]]; then
  echo "Demo test passed but no Playwright video found under $VIDEO_DIR"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found — demo video (convert manually): $LATEST"
  exit 1
fi

OUT="$ROOT/docs/metamask-demo-full-flow.gif"
ffmpeg -y -i "$LATEST" \
  -vf "fps=10,scale=560:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff:max_colors=256[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"

mkdir -p "$ROOT/wallets/metamask/docs"
cp "$OUT" "$ROOT/wallets/metamask/docs/metamask-demo-full-flow.gif"

echo "Full-flow demo passed — written $OUT ($(wc -c < "$OUT") bytes) from $LATEST"
