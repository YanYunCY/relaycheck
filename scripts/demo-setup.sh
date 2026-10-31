# Sourced (hidden) by docs/demo*.tape before recording. Local mocks only: no real API, no real key.
# `npx relaycheck` is mapped to the local build so the recording shows the command users will type.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f dist/cli.js ] || npm run build >/dev/null
node dist/cli.js mock --kind honest --port 8787 >/dev/null 2>&1 &
node dist/cli.js mock --kind swap   --port 8788 >/dev/null 2>&1 &
node dist/cli.js mock --kind inject --port 8789 >/dev/null 2>&1 &
trap 'kill $(jobs -p) 2>/dev/null' EXIT
for _ in $(seq 1 50); do
  curl -fsS http://localhost:8787/health >/dev/null 2>&1 && curl -fsS http://localhost:8788/health >/dev/null 2>&1 \
    && curl -fsS http://localhost:8789/health >/dev/null 2>&1 && break
  sleep 0.1
done
export RELAY_KEY=sk-demo-not-a-real-key FORCE_COLOR=1
npx() { [ "${1:-}" = relaycheck ] && shift; node "$ROOT/dist/cli.js" "$@"; }
banner() { # $1 = big line, $2 = sub line
  clear
  printf '\n\n\n\n\n\n\n\n\n\n\n\n\n\n     \033[1;38;5;255m%s\033[0m\n\n     \033[38;5;248m%s\033[0m\n\n\n\n' "$1" "$2"
}
case "${LANG:-}" in
  zh*) intro() { banner 'relaycheck 验货  ·  你买的是 Claude，拿到的是什么？' '同一条命令，三家本地模拟中转：诚实 / 换模型 / 偷加 token'; }
       outro() { banner '统计检验，不是拍脑袋。  npx relaycheck <中转地址> --model <模型>' 'key 不离开本机  ·  --card 生成可分享报告卡  ·  开源 MIT'; } ;;
  *)   intro() { banner 'relaycheck  ·  You paid for Claude. What did you get?' 'Same command, three local mock relays: honest / model swap / hidden tokens'; }
       outro() { banner 'A p-value, not a vibe.   npx relaycheck <relay-url> --model <name>' 'Your key never leaves your machine  ·  --card writes a shareable report card  ·  MIT'; } ;;
esac
PS1='\[\e[38;5;244m\]relaycheck\[\e[0m\] \[\e[1;32m\]$\[\e[0m\] '
