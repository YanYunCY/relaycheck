/**
 * Pure-TS statistics used by the identity fingerprint test.
 *  - chi-square test of homogeneity (2 x K contingency table)
 *  - chi-square survival function via the regularized incomplete gamma
 *  - Jensen–Shannon divergence (base 2, in [0, 1])
 *  - sequential Monte Carlo (parametric bootstrap under the pooled null) p-values
 *  - Cauchy combination test (Liu & Xie 2020) to merge per-probe p-values
 */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
  }
  return 1 - gammaQ(a, x);
}

/** Regularized upper incomplete gamma Q(a, x) = 1 - P(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaP(a, x);
  // Lentz continued fraction
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.max(0, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h);
}

/** P(X >= x) for X ~ chi-square(df). */
export function chiSquareSf(x: number, df: number): number {
  if (df <= 0) return 1;
  if (x <= 0) return 1;
  return gammaQ(df / 2, x / 2);
}

export interface ChiSquareResult {
  stat: number;
  df: number;
  p: number;
}

/** Chi-square test of homogeneity between two count vectors over the same categories. */
export function chiSquareHomogeneity(a: number[], b: number[]): ChiSquareResult {
  if (a.length !== b.length) throw new Error('count vectors must have equal length');
  const na = sum(a);
  const nb = sum(b);
  const n = na + nb;
  if (na === 0 || nb === 0) return { stat: 0, df: 0, p: 1 };
  let stat = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    const col = a[i] + b[i];
    if (col === 0) continue;
    k++;
    const ea = (na * col) / n;
    const eb = (nb * col) / n;
    stat += (a[i] - ea) ** 2 / ea + (b[i] - eb) ** 2 / eb;
  }
  const df = Math.max(0, k - 1);
  return { stat, df, p: df === 0 ? 1 : chiSquareSf(stat, df) };
}

/** Chi-square goodness of fit of observed counts against expected probabilities. */
export function chiSquareGoodnessOfFit(observed: number[], probs: number[]): ChiSquareResult {
  const n = sum(observed);
  let stat = 0;
  let k = 0;
  for (let i = 0; i < observed.length; i++) {
    const e = n * probs[i];
    if (e <= 0) {
      if (observed[i] > 0) stat = Infinity;
      continue;
    }
    k++;
    stat += (observed[i] - e) ** 2 / e;
  }
  const df = Math.max(0, k - 1);
  return { stat, df, p: df === 0 ? 1 : stat === Infinity ? 0 : chiSquareSf(stat, df) };
}

export function normalize(counts: number[]): number[] {
  const s = sum(counts);
  return s === 0 ? counts.map(() => 0) : counts.map((c) => c / s);
}

/** Jensen–Shannon divergence in bits (0 = identical, 1 = disjoint). */
export function jensenShannon(p: number[], q: number[]): number {
  const P = normalize(p);
  const Q = normalize(q);
  let js = 0;
  for (let i = 0; i < P.length; i++) {
    const m = (P[i] + Q[i]) / 2;
    if (P[i] > 0) js += 0.5 * P[i] * Math.log2(P[i] / m);
    if (Q[i] > 0) js += 0.5 * Q[i] * Math.log2(Q[i] / m);
  }
  return Math.max(0, Math.min(1, js));
}

export function multinomialSample(n: number, probs: number[], rng: () => number): number[] {
  const cdf: number[] = [];
  let acc = 0;
  for (const p of probs) cdf.push((acc += p));
  return sampleFromCdf(n, cdf, rng, probs.map(() => 0));
}

function sampleFromCdf(n: number, cdf: number[], rng: () => number, out: number[]): number[] {
  out.fill(0);
  const acc = cdf[cdf.length - 1];
  const last = cdf.length - 1;
  for (let i = 0; i < n; i++) {
    const u = rng() * acc;
    let j = 0;
    while (j < last && u >= cdf[j]) j++;
    out[j]++;
  }
  return out;
}

/** chi-square homogeneity statistic only (hot loop of the Monte Carlo test) */
function chiStat(a: number[], b: number[], na: number, nb: number): number {
  const n = na + nb;
  let stat = 0;
  for (let i = 0; i < a.length; i++) {
    const col = a[i] + b[i];
    if (col === 0) continue;
    const ea = (na * col) / n;
    const eb = (nb * col) / n;
    const da = a[i] - ea;
    const db = b[i] - eb;
    stat += (da * da) / ea + (db * db) / eb;
  }
  return stat;
}

/**
 * Cochran's rule for the 2 x K table: every expected count >= 1 and >= 80% of them >= 5.
 * Only then is the asymptotic chi-square tail trusted beyond the Monte Carlo floor.
 */
export function asymptoticOk(a: number[], b: number[]): boolean {
  const na = sum(a);
  const nb = sum(b);
  const n = na + nb;
  let cells = 0;
  let ge5 = 0;
  for (let i = 0; i < a.length; i++) {
    const col = a[i] + b[i];
    if (col === 0) continue;
    for (const e of [(na * col) / n, (nb * col) / n]) {
      cells++;
      if (e < 1) return false;
      if (e >= 5) ge5++;
    }
  }
  return cells > 0 && ge5 >= 0.8 * cells;
}

export interface HomogeneityTest extends ChiSquareResult {
  /** p-value actually used */
  pValue: number;
  /**
   * monte-carlo: sequential MC p-value (valid, slightly conservative)
   * mc-floor: no simulated table was as extreme; p is the MC resolution bound
   * asymptotic-tail: MC floor reached and the table is dense enough to trust the chi-square tail
   */
  method: 'monte-carlo' | 'mc-floor' | 'asymptotic-tail';
  /** number of Monte Carlo tables simulated */
  reps: number;
  js: number;
}

export interface McOptions {
  /** stop once this many simulated statistics reach the observed one (Besag–Clifford) */
  hits?: number;
  /** maximum simulations before declaring the floor */
  maxReps?: number;
  /** simulations used to push the floor down when the first pass saw no exceedance */
  extendReps?: number;
  /**
   * Lancaster mid-p: count simulated statistics that TIE the observed one as half.
   * Discrete tables (near one-hot answer distributions) make the ordinary p-value very
   * conservative, and the Cauchy combination inherits that; mid-p restores near-nominal size.
   * Default true; set false for the strictly conservative p-value.
   */
  midP?: boolean;
  /**
   * Over-dispersion factor φ ≥ 1 of the endpoint (answers inside one time block are mildly
   * correlated, so counts vary more than multinomial). The observed statistic is divided by φ
   * before it is compared (quasi-likelihood correction). Default 1.
   */
  dispersion?: number;
}

/**
 * Two-sample chi-square homogeneity test with a Monte Carlo PERMUTATION p-value: answers of
 * both samples are pooled and randomly re-split into groups of the original sizes
 * (conditional on the margins, like the Fisher–Freeman–Halton exact test). Unlike a
 * parametric bootstrap from the pooled estimate, this is exactly valid for any sample size
 * and any sparsity, and it accounts for the sampling noise of the reference.
 *
 * Sequential stopping (Besag & Clifford 1991): simulate until `hits` statistics reach the
 * observed one (p = hits / L) or `maxReps` is reached (p = (k+1)/(L+1)). Both are valid
 * p-values. When nothing reaches the observed table, the floor 1/(L+1) is reported; the
 * asymptotic tail is used below the floor only for dense tables (Cochran's rule), because
 * for sparse tables (one-hot reference distributions) it is badly anti-conservative.
 */
export function homogeneityTest(a: number[], b: number[], rng: () => number, maxRepsOrOpts: number | McOptions = {}): HomogeneityTest {
  const o: McOptions = typeof maxRepsOrOpts === 'number' ? { maxReps: maxRepsOrOpts } : maxRepsOrOpts;
  const hits = o.hits ?? 40;
  const maxReps = o.maxReps ?? 20000;
  const extendReps = o.extendReps ?? 10 * maxReps;
  const raw = chiSquareHomogeneity(a, b);
  const phi = Math.max(1, o.dispersion ?? 1);
  const base = phi === 1 ? raw : { ...raw, stat: raw.stat / phi, p: raw.df === 0 ? 1 : chiSquareSf(raw.stat / phi, raw.df) };
  const js = jensenShannon(a, b);
  if (base.df === 0) return { ...base, pValue: 1, method: 'monte-carlo', reps: 0, js };
  const na = sum(a);
  const nb = sum(b);
  const pooled = a.map((x, i) => x + b[i]);
  const n = na + nb;
  const sa = pooled.map(() => 0);
  const sb = pooled.map(() => 0);
  const left = pooled.slice();
  const tol = 1e-9 * Math.max(1, base.stat);
  const target = base.stat - tol;
  const midP = o.midP ?? true;
  let total = 0;
  let exceed = 0;
  let ties = 0;
  // the smaller sample is drawn without replacement from the pooled answers; the rest is the other sample
  const small = Math.min(na, nb);
  const smallIsA = na <= nb;
  const run = (limit: number, stopAt: number) => {
    while (total < limit && exceed < stopAt) {
      for (let i = 0; i < left.length; i++) left[i] = pooled[i];
      const draw = smallIsA ? sa : sb;
      const rest = smallIsA ? sb : sa;
      draw.fill(0);
      let remaining = n;
      for (let d = 0; d < small; d++) {
        let u = Math.floor(rng() * remaining);
        let j = 0;
        while (u >= left[j]) u -= left[j++];
        left[j]--;
        draw[j]++;
        remaining--;
      }
      for (let i = 0; i < pooled.length; i++) rest[i] = pooled[i] - draw[i];
      total++;
      const st = chiStat(sa, sb, na, nb);
      if (st >= target) {
        exceed++;
        if (st <= base.stat + tol) ties++;
      }
    }
  };
  // ties count half (mid-p); the observed table itself is one tie
  const mc = (plusOne: boolean) => {
    const e = midP ? exceed - ties / 2 - (plusOne ? 0.5 : 0) : exceed;
    return plusOne ? (e + 1) / (total + 1) : e / total;
  };
  run(maxReps, hits);
  if (exceed >= hits) return { ...base, pValue: mc(false), method: 'monte-carlo', reps: total, js };
  if (exceed === 0 && extendReps > total) run(extendReps, 1);
  if (exceed > 0) return { ...base, pValue: mc(true), method: 'monte-carlo', reps: total, js };
  const floor = 1 / (total + 1);
  if (asymptoticOk(a, b) && base.p < floor) return { ...base, pValue: base.p, method: 'asymptotic-tail', reps: total, js };
  return { ...base, pValue: floor, method: 'mc-floor', reps: total, js };
}

/**
 * Cauchy combination test: T = Σ w_i tan((0.5 - p_i)π), p = 1/2 - arctan(T)/π.
 * Valid under arbitrary dependence (asymptotically), behaves like a harmonic mean of p-values.
 */
export function cauchyCombination(pValues: number[], weights?: number[]): number {
  if (pValues.length === 0) return 1;
  const w = weights ?? pValues.map(() => 1 / pValues.length);
  const ws = sum(w);
  let t = 0;
  for (let i = 0; i < pValues.length; i++) {
    // truncate large p-values: tan((0.5-p)π) → -∞ as p → 1, so one p=1 probe would mask every signal
    const p = Math.min(0.99, Math.max(0, pValues[i]));
    const wi = w[i] / ws;
    if (p < 1e-15) t += wi / (Math.max(p, 1e-300) * Math.PI);
    else t += wi * Math.tan((0.5 - p) * Math.PI);
  }
  if (t > 1e15) return Math.max(0, 1 / (t * Math.PI));
  return Math.min(1, Math.max(0, 0.5 - Math.atan(t) / Math.PI));
}

/** Pearson chi-square of an R x K table (rows = time blocks, cols = answers); empty columns ignored. */
export function rxkChiSquare(rows: number[][]): { stat: number; df: number } {
  const R = rows.length;
  if (R < 2) return { stat: 0, df: 0 };
  const K = rows[0].length;
  const rs = rows.map((r) => sum(r));
  const cs = Array.from({ length: K }, (_, j) => rows.reduce((acc, r) => acc + r[j], 0));
  const n = sum(rs);
  const kk = cs.filter((c) => c > 0).length;
  const rr = rs.filter((r) => r > 0).length;
  let stat = 0;
  for (let i = 0; i < R; i++)
    for (let j = 0; j < K; j++) {
      const e = (rs[i] * cs[j]) / n;
      if (e > 0) stat += (rows[i][j] - e) ** 2 / e;
    }
  return { stat, df: Math.max(0, (rr - 1) * (kk - 1)) };
}

/**
 * Pooled over-dispersion estimate φ̂ = Σχ² / Σdf over probes, where each probe's χ² compares
 * its answer counts across time blocks of the trusted endpoint. φ̂ ≈ 1 means the endpoint
 * behaves like independent multinomial draws.
 */
export function estimateDispersion(probeBlocks: number[][][]): { phi: number; df: number; stat: number } {
  let st = 0;
  let df = 0;
  for (const rows of probeBlocks) {
    const r = rxkChiSquare(rows);
    st += r.stat;
    df += r.df;
  }
  return { phi: df ? st / df : 1, df, stat: st };
}

/** Align two label→count maps over the union of labels (sorted). */
export function alignDistributions(
  a: Record<string, number>,
  b: Record<string, number>,
): { labels: string[]; a: number[]; b: number[] } {
  const labels = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return { labels, a: labels.map((k) => a[k] ?? 0), b: labels.map((k) => b[k] ?? 0) };
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function formatP(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return 'n/a';
  if (p === 0) return '<1e-300';
  if (p < 1e-4) return p.toExponential(1);
  if (p >= 0.9995) return '1.000';
  return p < 0.001 ? p.toFixed(4) : p.toFixed(3);
}
