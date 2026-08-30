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
POINTER="$SPIKE/test-results/demo-video-path.txt"
rm -f "$VIDEO_DIR"/*.webm "$POINTER" 2>/dev/null || true

cd "$SPIKE"
pnpm exec playwright test tests/demo-full-flow.spec.ts

# The spec records which video belongs to the dapp page. Never pick by file size: MetaMask's
# home page stays open for the whole run doing nothing, so its recording is always the largest
# and produces a GIF of a motionless wallet screen.
if [[ ! -f "$POINTER" ]]; then
  echo "Demo test passed but $POINTER was not written — cannot identify the dapp recording."
  exit 1
fi
LATEST="$(cat "$POINTER")"
if [[ ! -f "$LATEST" ]]; then
  echo "Demo video path recorded as $LATEST but that file does not exist."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found — demo video (convert manually): $LATEST"
  exit 1
fi

# Playback speed. The real run is ~90s of mostly waiting on Sepolia blocks; DEMO_SPEED collapses
# that into something watchable at the top of a README.
SPEED="${DEMO_SPEED:-4}"

OUT="$ROOT/docs/metamask-demo-full-flow.gif"
ffmpeg -y -i "$LATEST" \
  -vf "setpts=PTS/${SPEED},fps=12,scale=560:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff:max_colors=256[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"

mkdir -p "$ROOT/wallets/metamask/docs"
cp "$OUT" "$ROOT/wallets/metamask/docs/metamask-demo-full-flow.gif"

echo "Full-flow demo passed — written $OUT ($(wc -c < "$OUT") bytes) from $LATEST"
