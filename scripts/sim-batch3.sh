#!/bin/sh
# Power simulations (no API calls): alternative = real answers of another model, optionally mixed
# with the genuine distribution (relay serves the genuine model a fraction w of the time).
# Shipped configuration: mid-p, dispersion correction with φ = 1.098, data over-dispersed with the same φ.
cd "$(dirname "$0")/.."
sim() { npx vite-node scripts/calibrate-sim.ts -- "$@" --fast --phi 1.098 --correct true 2>/dev/null; }
for m in gpt-5.6-luna gpt-5-nano gpt-5.4-nano; do for w in 0 0.5 0.7 0.8 0.9; do sim --mode power --sims 500 --seed 5 --alt calib/raw/power-$m.jsonl --w $w >> calib/sim/power-$m-w$w.jsonl; done; done
for n in 6 12 48; do for w in 0 0.8; do sim --mode power --sims 500 --seed 6 --testN $n --alt calib/raw/power-gpt-5.6-luna.jsonl --w $w >> calib/sim/power-gpt-5.6-luna-w$w-n$n.jsonl; done; done
sim --mode null --sims 2000 --seed 6 --testN 12 >> calib/sim/null-v2ref-phi1.098-true-n12.jsonl
echo done > calib/sim/batch3.done
