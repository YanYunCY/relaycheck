/**
 * Light, mock-only calibration checks of the identity test (the full experiments are in
 * scripts/calibrate-sim.ts and docs/METHOD.md). Truth = the shipped real gpt-6-luna reference.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRef } from '../src/fingerprint.js';
import { scoreIdentity } from '../src/probes/identity.js';
import { mulberry32 } from '../src/rng.js';
import { estimateDispersion, homogeneityTest, multinomialSample, rxkChiSquare } from '../src/stats.js';

const ref = loadRef(resolve(__dirname, '..', 'refs', 'gpt-6-luna.json'));
const labelsOf = (d: Record<string, number>) => [...Object.keys(d), 'zzz_unseen'];
const probs = (d: Record<string, number>, labs: string[]) => {
  const n = Object.values(d).reduce((a, b) => a + b, 0);
  return labs.map((l) => (d[l] ?? 0) / n);
};
const toDist = (labs: string[], v: number[]) => Object.fromEntries(labs.map((l, i) => [l, v[i]]).filter(([, c]) => (c as number) > 0));

function nullRuns(sims: number, seed: number, testN = 24) {
  const rng = mulberry32(seed);
  const ps: number[] = [];
  for (let s = 0; s < sims; s++) {
    const simRef = { probes: ref.probes.map((rp) => { const labs = labelsOf(rp.dist); return { id: rp.id, prompt: rp.prompt, dist: toDist(labs, multinomialSample(100, probs(rp.dist, labs), rng)) }; }) };
    const obs = ref.probes.map((rp) => { const labs = labelsOf(rp.dist); return { id: rp.id, errors: 0, dist: toDist(labs, multinomialSample(testN, probs(rp.dist, labs), rng)) }; });
    ps.push(scoreIdentity(obs, simRef, seed * 1000 + s, { maxReps: 4000, extendReps: 0 }).pValue ?? 1);
  }
  return ps;
}

describe('identity test calibration (mock-level)', () => {
  it('null false-positive rate is near nominal (300 simulated honest runs)', () => {
    const ps = nullRuns(300, 17);
    const below = (a: number) => ps.filter((p) => p < a).length / ps.length;
    expect(below(0.001)).toBeLessThanOrEqual(0.01); // nominal 0.1 %
    expect(below(0.05)).toBeLessThan(0.1); // nominal 5 %
    expect(below(0.05)).toBeGreaterThan(0.005); // not absurdly conservative (the 0.1 permutation-without-mid-p was ~1 %)
  });
  it('catches a model whose favourite answers moved (power)', () => {
    const rng = mulberry32(3);
    let caught = 0;
    for (let s = 0; s < 20; s++) {
      // alternative: every probe's top answer swapped with its runner-up
      const obs = ref.probes.map((rp) => {
        const labs = labelsOf(rp.dist);
        const p = probs(rp.dist, labs);
        const order = p.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]);
        const q = p.slice();
        if (order[1][0] > 0) [q[order[0][1]], q[order[1][1]]] = [p[order[1][1]], p[order[0][1]]];
        return { id: rp.id, errors: 0, dist: toDist(labs, multinomialSample(24, q, rng)) };
      });
      if ((scoreIdentity(obs, ref, s, { maxReps: 4000, extendReps: 0 }).pValue ?? 1) < 0.001) caught++;
    }
    expect(caught).toBe(20);
  });
});

describe('over-dispersion', () => {
  it('R x K chi-square and pooled dispersion', () => {
    expect(rxkChiSquare([[10, 10], [10, 10]])).toEqual({ stat: 0, df: 1 });
    expect(rxkChiSquare([[20, 0], [0, 20]]).stat).toBeCloseTo(40, 8);
    expect(rxkChiSquare([[5, 5]])).toEqual({ stat: 0, df: 0 });
    const e = estimateDispersion([[[20, 0], [0, 20]], [[10, 10], [10, 10]]]);
    expect(e.df).toBe(2);
    expect(e.phi).toBeCloseTo(20, 8);
  });
  it('multinomial blocks give φ ≈ 1', () => {
    const rng = mulberry32(8);
    const probes = Array.from({ length: 30 }, () => Array.from({ length: 10 }, () => multinomialSample(24, [0.5, 0.3, 0.2], rng)));
    const e = estimateDispersion(probes);
    expect(e.phi).toBeGreaterThan(0.8);
    expect(e.phi).toBeLessThan(1.2);
  });
  it('dividing by φ makes the per-probe test less eager, never more', () => {
    const a = [20, 4];
    const b = [60, 40];
    const p1 = homogeneityTest(a, b, mulberry32(1)).pValue;
    const p2 = homogeneityTest(a, b, mulberry32(1), { dispersion: 1.5 }).pValue;
    expect(p2).toBeGreaterThan(p1);
    expect(homogeneityTest(a, b, mulberry32(1), { dispersion: 0.5 }).pValue).toBe(p1); // φ < 1 is floored at 1
  });
  it('scoreIdentity reads φ from the reference', () => {
    const r = { probes: [{ id: 'x', prompt: '', dist: { a: 60, b: 40 } }], dispersion: { phi: 1.5, df: 10, blocks: 4, source: 't' } };
    const obs = [{ id: 'x', dist: { a: 20, b: 4 }, errors: 0 }];
    expect(scoreIdentity(obs, r, 1).pValue!).toBeGreaterThan(scoreIdentity(obs, { probes: r.probes }, 1).pValue!);
  });
});

describe('Monte Carlo p-value details', () => {
  it('mid-p is never larger than the conservative p and both are valid probabilities', () => {
    const rng = () => mulberry32(4);
    for (const [a, b] of [[[24, 0], [95, 5]], [[12, 12], [50, 50]], [[3, 21], [90, 10]]] as [number[], number[]][]) {
      const mid = homogeneityTest(a, b, rng()).pValue;
      const cons = homogeneityTest(a, b, rng(), { midP: false }).pValue;
      expect(mid).toBeLessThanOrEqual(cons + 1e-12);
      expect(mid).toBeGreaterThan(0);
      expect(cons).toBeLessThanOrEqual(1);
    }
  });
  it('sequential stopping: an obviously null table stops early', () => {
    const t = homogeneityTest([12, 12], [50, 50], mulberry32(2));
    expect(t.method).toBe('monte-carlo');
    expect(t.reps).toBeLessThan(200);
  });
  it('permutation null keeps margins: identical proportions give p ≈ 1', () => {
    expect(homogeneityTest([6, 6, 12], [25, 25, 50], mulberry32(9)).pValue).toBeGreaterThan(0.9);
  });
});
