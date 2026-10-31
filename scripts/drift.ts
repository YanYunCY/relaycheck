/**
 * Stationarity diagnostics on collected official samples (no API calls):
 *  1. within-collection heterogeneity: R x K permutation chi-square across consecutive runs of 24
 *     (overdispersion = answers within a time block are correlated)
 *  2. pooled fresh samples vs the reference, per probe (drift between reference time and now)
 */
import { readFileSync } from 'node:fs';
import { loadRef } from '../src/fingerprint.js';
import { classify } from '../src/probes/classify.js';
import { probeSet } from '../src/probes/probesets.js';
import { hash32, mulberry32 } from '../src/rng.js';
import { alignDistributions, chiSquareSf, formatP, homogeneityTest } from '../src/stats.js';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ref = loadRef(arg('ref', 'refs/gpt-6-luna.json'));
const set = probeSet(ref.probeSetVersion ?? 1)!;
const block = Number(arg('block', '24'));
const by: Record<string, string[]> = {};
for (const line of readFileSync(arg('raw', ''), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  const def = set.probes.find((p) => p.id === r.probe);
  if (!def || r.error) continue;
  (by[r.probe] ??= []).push(classify(def.labels, r.text, def.aliases));
}
function rxk(rows: number[][]): number {
  const R = rows.length, K = rows[0].length;
  const rs = rows.map((r) => r.reduce((a, b) => a + b, 0));
  const cs = Array.from({ length: K }, (_, j) => rows.reduce((a, r) => a + r[j], 0));
  const n = rs.reduce((a, b) => a + b, 0);
  let x = 0;
  for (let i = 0; i < R; i++) for (let j = 0; j < K; j++) { const e = (rs[i] * cs[j]) / n; if (e > 0) x += (rows[i][j] - e) ** 2 / e; }
  return x;
}
const rng = mulberry32(5);
let sumStat = 0, sumDf = 0;
const lines: string[] = [];
for (const rp of ref.probes) {
  const labs = by[rp.id] ?? [];
  const uni = [...new Set(labs)].sort();
  const nb = Math.floor(labs.length / block);
  const rows = Array.from({ length: nb }, (_, b) => uni.map((u) => labs.slice(b * block, (b + 1) * block).filter((x) => x === u).length));
  const obs = rxk(rows);
  const df = (nb - 1) * (uni.length - 1);
  // permutation p-value: shuffle labels across blocks
  let ge = 0; const R = 2000; const flat = labs.slice(0, nb * block);
  for (let r = 0; r < R; r++) {
    for (let i = flat.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [flat[i], flat[j]] = [flat[j], flat[i]]; }
    const rr = Array.from({ length: nb }, (_, b) => uni.map((u) => flat.slice(b * block, (b + 1) * block).filter((x) => x === u).length));
    if (rxk(rr) >= obs - 1e-9) ge++;
  }
  sumStat += obs; sumDf += df;
  const pooled: Record<string, number> = {};
  for (const l of labs) pooled[l] = (pooled[l] ?? 0) + 1;
  const al = alignDistributions(pooled, rp.dist);
  const t = homogeneityTest(al.a, al.b, mulberry32(hash32(rp.id)), {});
  lines.push(`${rp.id.padEnd(11)} blocks=${nb} withinP=${formatP((ge + 1) / (R + 1)).padEnd(6)} dispersion=${df ? (obs / df).toFixed(2) : '-'}  fresh(${labs.length}) vs ref(100) p=${formatP(t.pValue).padEnd(7)} fresh=${JSON.stringify(pooled)}`);
}
console.log(lines.join('\n'));
console.log(`overall dispersion (Σχ²/Σdf across probes) = ${(sumStat / sumDf).toFixed(3)}  (1 = multinomial; χ² p=${formatP(chiSquareSf(sumStat, sumDf))})`);
