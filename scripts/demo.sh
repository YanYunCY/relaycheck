#!/usr/bin/env bash
# relaycheck demo: an honest relay vs. a model-swapping relay, both local mocks.
# No real API is called and no real key is used.
#   bash scripts/demo.sh            # reports one after another (colored)
#   bash scripts/demo.sh --side     # reports side by side (plain text, needs a wide terminal)
#   LANG_OPT=zh bash scripts/demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f dist/cli.js ] || npm run build >/dev/null
HONEST_PORT=${HONEST_PORT:-8787}
SWAP_PORT=${SWAP_PORT:-8788}
LANG_OPT=${LANG_OPT:-en}
SAMPLES=${SAMPLES:-24}
mkdir -p out

node dist/cli.js mock --kind honest --port "$HONEST_PORT" >/dev/null & P1=$!
node dist/cli.js mock --kind swap   --port "$SWAP_PORT"   >/dev/null & P2=$!
trap 'kill $P1 $P2 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$HONEST_PORT/health" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$SWAP_PORT/health" >/dev/null 2>&1 && break
  sleep 0.1
done

export RELAY_KEY=sk-demo-not-a-real-key
run() { # $1=name $2=port, extra args after
  local name=$1 port=$2; shift 2
  node dist/cli.js "http://127.0.0.1:$port" --model mock-sonnet --ref refs/mock-honest.json \
    --samples "$SAMPLES" --lang "$LANG_OPT" --quiet \
    --json "out/$name.json" --html "out/$name.html" --card "out/$name.svg" "$@" && code=0 || code=$?
  return 0
}

if [ "${1:-}" = "--side" ]; then
  W=$(( $(tput cols 2>/dev/null || echo 200) ))
  NO_COLOR=1 run honest "$HONEST_PORT" > out/honest.txt
  NO_COLOR=1 run swap "$SWAP_PORT" > out/swap.txt
  { echo "### relay A: honest"; cat out/honest.txt; } > out/a.txt
  { echo "### relay B: swap"; cat out/swap.txt; } > out/b.txt
  pr -m -t -w "$W" out/a.txt out/b.txt
else
  printf '\n\033[1m$ npx relaycheck http://127.0.0.1:%s --model mock-sonnet   # relay A (local mock: honest)\033[0m\n\n' "$HONEST_PORT"
  FORCE_COLOR=1 run honest "$HONEST_PORT"; echo "exit code: $code"
  printf '\n\033[1m$ npx relaycheck http://127.0.0.1:%s --model mock-sonnet   # relay B (local mock: swap)\033[0m\n\n' "$SWAP_PORT"
  FORCE_COLOR=1 run swap "$SWAP_PORT"; echo "exit code: $code"
fi
echo
echo "report cards: out/honest.svg out/swap.svg  ·  HTML: out/honest.html out/swap.html"
