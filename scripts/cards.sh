#!/usr/bin/env bash
# Regenerate the example share cards and social preview from local mock relays (no real API, no real key).
# Needs rsvg-convert (librsvg2-bin), a CJK font (fonts-noto-cjk), Inter and JetBrains Mono to rasterise the SVGs.
#   docs/card-{pass,fail}.png              default card style (slip, Chinese primary)
#   docs/design/round2/card-<name>-*.png   round-2 directions: slip (default), lab, night
#   docs/design/round2/social-<name>.*     round-2 social directions (scripts/gen-social.py)
#   docs/design/card-{A,B}-*.png           round-1 directions (A = ink, B = stamp)
#   docs/social-preview.{svg,png}          = round2/social-slip.svg
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build >/dev/null
mkdir -p out docs/design
node dist/cli.js mock --kind honest --port 8797 >/dev/null & P1=$!
node dist/cli.js mock --kind swap   --port 8798 >/dev/null & P2=$!
trap 'kill $P1 $P2 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -fsS http://127.0.0.1:8797/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:8798/health >/dev/null 2>&1 && break
  sleep 0.1
done
export RELAY_KEY=sk-demo-not-a-real-key NO_COLOR=1
card() { # style kind port out
  RELAYCHECK_CARD_STYLE=$1 node dist/cli.js http://127.0.0.1:$3 --model mock-sonnet --ref refs/mock-honest.json --lang zh --quiet --card "out/$4.svg" >/dev/null || true
}
card "" honest 8797 card-pass
card "" swap 8798 card-fail
rsvg-convert -w 1200 -h 630 out/card-pass.svg -o docs/card-pass.png
rsvg-convert -w 1200 -h 630 out/card-fail.svg -o docs/card-fail.png
mkdir -p docs/design/round2
for s in slip lab night; do
  card "$s" honest 8797 "card-$s-pass"
  card "$s" swap 8798 "card-$s-fail"
  for v in pass fail; do
    rsvg-convert -w 1200 -h 630 "out/card-$s-$v.svg" -o "docs/design/round2/card-$s-$v.png"
    rsvg-convert -w 400 "out/card-$s-$v.svg" -o "out/card-$s-$v-400.png"
  done
done
python3 scripts/gen-social.py >/dev/null
cp docs/design/round2/social-slip.svg docs/social-preview.svg
for s in slip lab night; do rsvg-convert -w 1280 -h 640 "docs/design/round2/social-$s.svg" -o "docs/design/round2/social-$s.png"; done
for d in A:ink B:stamp; do
  n=${d%%:*}; s=${d#*:}
  card "$s" honest 8797 "card-$n-pass"
  card "$s" swap 8798 "card-$n-fail"
  for v in pass fail; do
    rsvg-convert -w 1200 -h 630 "out/card-$n-$v.svg" -o "docs/design/card-$n-$v.png"
    rsvg-convert -w 400 "out/card-$n-$v.svg" -o "out/card-$n-$v-400.png"
  done
done
rsvg-convert -w 1280 -h 640 docs/social-preview.svg -o docs/social-preview.png
for n in A B; do rsvg-convert -w 1280 -h 640 "docs/design/social-$n.svg" -o "docs/design/social-$n.png"; done
echo "wrote docs/card-{pass,fail}.png docs/design/*.png docs/social-preview.png"
