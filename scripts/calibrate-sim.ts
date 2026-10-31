/**
 * Mock-level calibration of the identity test (no API calls).
 * Simulates the full scoring pipeline (per-probe sequential MC homogeneity test → Cauchy):
 *   null:  reference ~ Mult(refN, P), test ~ Mult(testN, P)     → empirical false-positive rate
 *   power: reference ~ Mult(refN, P), test ~ Mult(testN, Q_mix) with Q_mix = w·P + (1-w)·Q
 * P = the real gpt-6-luna reference distributions; Q = another model's observed distributions.
 *   npx vite-node scripts/calibrate-sim.ts -- --mode null --sims 2000 --seed 1 [--ref file] [--alt calib/raw/x.jsonl] [--w 0] [--testN 24] [--truth ref|dirichlet]
 */
import { readFileSync } from 'node:fs';
import { loadRef } from '../src/fingerprint.js';
import { type ObservedProbe, scoreIdentity, FAIL_P, WARN_P } from '../src/probes/identity.js';
import { classify } from '../src/probes/classify.js';
import { probeSet } from '../src/probes/probesets.js';
import { mulberry32 } from '../src/rng.js';
import { multinomialSample } from '../src/stats.js';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const mode = arg('mode', 'null');
const sims = Number(arg('sims', '1000'));
const seed = Number(arg('seed', '1'));
const refN = Number(arg('refN', '100'));
const testN = Number(arg('testN', '24'));
const w = Number(arg('w', '0'));
const truthKind = arg('truth', 'ref');
const midP = arg('pv', 'mid') === 'mid';
// over-dispersed endpoint: every time block draws its own answer distribution ~ Dirichlet(c·P), so
// counts of n answers in one block have variance inflated by φ = (n + c)/(1 + c)
const phi = Number(arg('phi', '1'));
const correct = arg('correct', 'none'); // none | true (use the true φ)
// --fast: no floor extension (MC floor 1/20001 instead of 1/220001); can only UNDER-state power
const fast = argv.includes('--fast');
const ref = loadRef(arg('ref', 'refs/gpt-6-luna.json'));
const set = probeSet(ref.probeSetVersion ?? 1)!;
const rng = mulberry32(seed * 7919 + 13);

// label universe per probe: probe labels + other
const universe = (id: string) => [...set.probes.find((p) => p.id === id)!.labels, 'other'];
const toVec = (id: string, d: Record<string, number>) => { const u = universe(id); const v = u.map((l) => d[l] ?? 0); const s = v.reduce((a, b) => a + b, 0) || 1; return v.map((x) => x / s); };
const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const gamma = (k: number): number => {
  if (k < 1) return gamma(k + 1) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { const x = normal(); const v = (1 + c * x) ** 3; if (v <= 0) continue; const u = rng(); if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v; }
};
// sparse random truths (alpha 0.3): many near-one-hot probes, like real LLM answer distributions
const dirichlet = (k: number, alpha: number) => { const g = Array.from({ length: k }, () => gamma(alpha)); const s = g.reduce((a, b) => a + b, 0); return g.map((x) => x / s); };

let P: Record<string, number[]> = {};
for (const rp of ref.probes) P[rp.id] = truthKind === 'dirichlet' ? dirichlet(universe(rp.id).length, 0.3) : toVec(rp.id, rp.dist);
let Q: Record<string, number[]> | null = null;
if (mode === 'power') {
  const alt = arg('alt', '');
  const counts: Record<string, Record<string, number>> = {};
  for (const line of readFileSync(alt, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.error || !P[r.probe]) continue;
    const def = set.probes.find((p) => p.id === r.probe)!;
    const lab = classify(def.labels, r.text, def.aliases);
    (counts[r.probe] ??= {})[lab] = (counts[r.probe][lab] ?? 0) + 1;
  }
  Q = {};
  for (const id of Object.keys(P)) Q[id] = toVec(id, counts[id] ?? {}).map((q, i) => w * P[id][i] + (1 - w) * q);
}
const toDist = (id: string, v: number[]) => { const u = universe(id); const d: Record<string, number> = {}; v.forEach((c, i) => { if (c) d[u[i]] = c; }); return d; };

const conc = (n: number) => (phi <= 1 ? Infinity : (n - phi) / (phi - 1));
const drawBlock = (n: number, p: number[]) => {
  const c = conc(n);
  if (!Number.isFinite(c)) return multinomialSample(n, p, rng);
  const g = p.map((x) => (x > 0 ? gamma(c * x) : 0));
  const s = g.reduce((a, b) => a + b, 0);
  return multinomialSample(n, g.map((x) => x / s), rng);
};
const drawRef = (p: number[]) => { const out = p.map(() => 0); for (let b = 0; b < 4; b++) drawBlock(refN / 4, p).forEach((x, i) => (out[i] += x)); return out; };
const ps: number[] = [];
const t0 = Date.now();
for (let s = 0; s < sims; s++) {
  const simRef = { probes: ref.probes.map((rp) => ({ id: rp.id, prompt: rp.prompt, dist: toDist(rp.id, drawRef(P[rp.id])) })), dispersion: correct === 'true' ? { phi, df: 0, blocks: 0, source: 'sim' } : undefined };
  const obs: ObservedProbe[] = ref.probes.map((rp) => ({ id: rp.id, errors: 0, dist: toDist(rp.id, drawBlock(testN, (Q ?? P)[rp.id])) }));
  const sc = scoreIdentity(obs, simRef, seed * 100000 + s, fast ? { midP, extendReps: 0 } : { midP });
  ps.push(sc.pValue ?? 1);
}
const rate = (a: number) => ps.filter((p) => p < a).length;
console.log(JSON.stringify({ mode, fast, phi, correct, pv: midP ? 'mid' : 'conservative', ref: arg('ref', 'refs/gpt-6-luna.json'), alt: arg('alt', ''), truth: truthKind, w, refN, testN, sims, seed, below_fail: rate(FAIL_P), below_warn: rate(WARN_P), below_05: rate(0.05), secs: (Date.now() - t0) / 1000, medianP: [...ps].sort((a, b) => a - b)[Math.floor(ps.length / 2)], below_half: rate(0.5) }));
