#!/bin/sh
# Over-dispersion and power simulations (no API calls).
cd "$(dirname "$0")/.."
sim() { npx vite-node scripts/calibrate-sim.ts -- "$@" 2>/dev/null; }
for phi in 1.1 1.3; do for c in none true; do for s in 1 2; do sim --mode null --sims 2000 --seed $s --phi $phi --correct $c >> calib/sim/null-v2ref-phi$phi-$c.jsonl; done; done; done
sim --mode null --sims 4000 --seed 9 --phi 1.098 --correct true >> calib/sim/null-v2ref-phi1.098-true.jsonl
for m in gpt-5.6-luna gpt-5-nano gpt-5.4-nano; do for w in 0 0.5 0.8 0.9; do sim --mode power --sims 1000 --seed 5 --alt calib/raw/power-$m.jsonl --w $w >> calib/sim/power-$m-w$w.jsonl; done; done
for n in 6 12; do sim --mode power --sims 1000 --seed 6 --testN $n --alt calib/raw/power-gpt-5.6-luna.jsonl --w 0 >> calib/sim/power-gpt-5.6-luna-w0-n$n.jsonl; done
echo done > calib/sim/batch2.done
