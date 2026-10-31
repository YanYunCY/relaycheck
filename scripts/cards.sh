#!/usr/bin/env bash
# Regenerate the example share cards in docs/ from local mock relays (no real API, no real key).
# Needs rsvg-convert (librsvg2-bin) and a CJK font (e.g. fonts-noto-cjk) to rasterise the SVGs.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build >/dev/null
mkdir -p out
node dist/cli.js mock --kind honest --port 8797 >/dev/null & P1=$!
node dist/cli.js mock --kind swap   --port 8798 >/dev/null & P2=$!
trap 'kill $P1 $P2 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -fsS http://127.0.0.1:8797/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:8798/health >/dev/null 2>&1 && break
  sleep 0.1
done
export RELAY_KEY=sk-demo-not-a-real-key NO_COLOR=1
node dist/cli.js http://127.0.0.1:8797 --model mock-sonnet --ref refs/mock-honest.json --quiet --card out/card-pass.svg >/dev/null || true
node dist/cli.js http://127.0.0.1:8798 --model mock-sonnet --ref refs/mock-honest.json --quiet --card out/card-fail.svg >/dev/null || true
rsvg-convert -w 1200 -h 630 out/card-pass.svg -o docs/card-pass.png
rsvg-convert -w 1200 -h 630 out/card-fail.svg -o docs/card-fail.png
echo "wrote docs/card-pass.png docs/card-fail.png"
