#!/bin/sh
# Mock-level calibration batch (no API calls). Appends one JSON line per chunk to calib/sim/*.jsonl
cd "$(dirname "$0")/.."
sim() { npx vite-node scripts/calibrate-sim.ts -- "$@" 2>/dev/null; }
for s in 1 2 3 4; do sim --mode null --sims 2500 --seed $s --ref refs/gpt-6-luna.json --pv mid >> calib/sim/null-v2ref-mid.jsonl; done
for s in 1 2; do sim --mode null --sims 2500 --seed $s --ref refs/gpt-6-luna.json --pv conservative >> calib/sim/null-v2ref-conservative.jsonl; done
for s in 1 2; do sim --mode null --sims 5000 --seed $s --ref calib/refs/gpt-6-luna.v1.json --pv mid >> calib/sim/null-v1ref-mid.jsonl; done
for s in 1 2 3 4 5; do sim --mode null --sims 1000 --seed $s --ref refs/gpt-6-luna.json --truth dirichlet --pv mid >> calib/sim/null-dirichlet-mid.jsonl; done
for n in 12 48; do sim --mode null --sims 2500 --seed 7 --testN $n --ref refs/gpt-6-luna.json --pv mid >> calib/sim/null-v2ref-mid-n$n.jsonl; done
echo done > calib/sim/batch1.done
