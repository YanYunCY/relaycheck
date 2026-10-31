import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng.js';
import {
  alignDistributions,
  cauchyCombination,
  chiSquareGoodnessOfFit,
  chiSquareHomogeneity,
  chiSquareSf,
  formatP,
  gammaP,
  gammaQ,
  homogeneityTest,
  jensenShannon,
  logGamma,
  multinomialSample,
} from '../src/stats.js';

describe('special functions', () => {
  it('logGamma matches factorials', () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 8);
    expect(Math.exp(logGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 8);
  });
  it('incomplete gamma P + Q = 1', () => {
    for (const [a, x] of [[0.5, 0.3], [3, 2], [10, 15], [2.5, 40]]) expect(gammaP(a, x) + gammaQ(a, x)).toBeCloseTo(1, 10);
  });
  it('chi-square survival function matches tables', () => {
    expect(chiSquareSf(3.841459, 1)).toBeCloseTo(0.05, 5);
    expect(chiSquareSf(18.307038, 10)).toBeCloseTo(0.05, 5);
    expect(chiSquareSf(6.634897, 1)).toBeCloseTo(0.01, 5);
    expect(chiSquareSf(0, 3)).toBe(1);
    expect(chiSquareSf(200, 2)).toBeLessThan(1e-40);
  });
});

describe('chi-square tests', () => {
  it('identical distributions give stat 0, p 1', () => {
    const r = chiSquareHomogeneity([10, 20, 30], [20, 40, 60]);
    expect(r.stat).toBeCloseTo(0, 12);
    expect(r.p).toBeCloseTo(1, 10);
    expect(r.df).toBe(2);
  });
  it('ignores categories empty in both samples', () => {
    expect(chiSquareHomogeneity([5, 0, 5], [5, 0, 5]).df).toBe(1);
  });
  it('known 2x2 example', () => {
    // [[10, 20], [30, 40]] → chi2 ≈ 0.7937
    const r = chiSquareHomogeneity([10, 20], [30, 40]);
    expect(r.stat).toBeCloseTo(0.79365, 4);
    expect(r.p).toBeCloseTo(0.373, 3);
  });
  it('goodness of fit', () => {
    const r = chiSquareGoodnessOfFit([25, 25, 25, 25], [0.25, 0.25, 0.25, 0.25]);
    expect(r.stat).toBe(0);
    expect(r.p).toBeCloseTo(1);
  });
});

describe('Jensen–Shannon', () => {
  it('is 0 for identical and 1 for disjoint', () => {
    expect(jensenShannon([1, 2, 3], [2, 4, 6])).toBeCloseTo(0, 12);
    expect(jensenShannon([1, 0], [0, 1])).toBeCloseTo(1, 12);
  });
  it('is symmetric', () => {
    expect(jensenShannon([5, 1, 1], [1, 1, 5])).toBeCloseTo(jensenShannon([1, 1, 5], [5, 1, 1]), 12);
  });
});

describe('Cauchy combination', () => {
  it('returns the input for a single p-value', () => {
    for (const p of [0.001, 0.2, 0.5, 0.9]) expect(cauchyCombination([p])).toBeCloseTo(p, 8);
  });
  it('equal p-values combine to the same p', () => {
    expect(cauchyCombination([0.03, 0.03, 0.03])).toBeCloseTo(0.03, 6);
  });
  it('is dominated by small p-values but stays in [0,1]', () => {
    const p = cauchyCombination([1e-20, 0.5, 0.9, 0.99]);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1e-18);
    expect(cauchyCombination([1, 1, 1])).toBeLessThanOrEqual(1);
    expect(cauchyCombination([])).toBe(1);
  });
  it('is roughly uniform under the null', () => {
    const rng = mulberry32(3);
    let below = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const ps = Array.from({ length: 16 }, () => rng());
      if (cauchyCombination(ps) < 0.05) below++;
    }
    expect(below / N).toBeGreaterThan(0.035);
    expect(below / N).toBeLessThan(0.065);
  });
});

describe('Monte Carlo homogeneity test', () => {
  it('multinomial sample sums to n', () => {
    const s = multinomialSample(100, [0.2, 0.3, 0.5], mulberry32(1));
    expect(s.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('does not reject samples from the same distribution', () => {
    const rng = mulberry32(11);
    const probs = [0.5, 0.2, 0.1, 0.1, 0.1];
    let rejections = 0;
    for (let i = 0; i < 40; i++) {
      const t = homogeneityTest(multinomialSample(24, probs, rng), multinomialSample(200, probs, rng), rng, 300);
      if (t.pValue < 0.01) rejections++;
    }
    expect(rejections).toBeLessThanOrEqual(3);
  });
  it('rejects clearly different sparse distributions at the Monte Carlo floor (no asymptotic tail)', () => {
    const rng = mulberry32(5);
    const t = homogeneityTest([20, 1, 1, 1, 1], [10, 10, 160, 10, 10], rng, 500);
    expect(t.method).toBe('mc-floor');
    expect(t.reps).toBe(5000);
    expect(t.pValue).toBeCloseTo(1 / 5001, 10);
    expect(t.js).toBeGreaterThan(0.3);
  });
  it('uses the asymptotic tail beyond the floor only for dense tables', () => {
    const rng = mulberry32(5);
    const t = homogeneityTest([150, 50, 50, 50], [50, 50, 50, 150], rng, 500);
    expect(t.method).toBe('asymptotic-tail');
    expect(t.pValue).toBeLessThan(1e-10);
  });
  it('aligns label maps', () => {
    expect(alignDistributions({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ labels: ['a', 'b', 'c'], a: [1, 2, 0], b: [0, 3, 4] });
  });
  it('formats p-values', () => {
    expect(formatP(0.00031)).toBe('0.0003');
    expect(formatP(0.00003)).toBe('3.0e-5');
    expect(formatP(0.0123)).toBe('0.012');
    expect(formatP(null)).toBe('n/a');
  });
});

import { cauchyCombination as cc2 } from '../src/stats.js';
import { describe as d2, it as it2, expect as ex2 } from 'vitest';
d2('cauchy truncation', () => {
  it2('a p=1 probe does not mask a strong signal', () => {
    ex2(cc2([1, 1, 1, 1e-10, 0.5])).toBeLessThan(1e-6);
  });
  it2('all-null stays non-significant', () => {
    ex2(cc2([1, 0.9, 0.5, 0.3, 0.99])).toBeGreaterThan(0.05);
  });
});
