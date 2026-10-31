import { readFileSync } from 'node:fs';
import { classify } from '../src/probes/classify.js';
import { jensenShannon, alignDistributions } from '../src/stats.js';
import { CANDIDATES } from './candidates.js';
const models = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5-nano', 'gpt-5.4-nano'];
const raw: Record<string, Record<string, string[]>> = {};
for (const m of models) {
  raw[m] = {};
  for (const line of readFileSync(`calib/raw/screen-${m}.jsonl`, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.error) continue;
    (raw[m][r.probe] ??= []).push(r.text);
  }
}
const H = (d: Record<string, number>) => { const n = Object.values(d).reduce((a, b) => a + b, 0); return -Object.values(d).reduce((a, c) => a + (c ? (c / n) * Math.log2(c / n) : 0), 0); };
const rows: any[] = [];
const others: string[] = [];
for (const c of CANDIDATES) {
  const dists: Record<string, Record<string, number>> = {};
  for (const m of models) {
    const d: Record<string, number> = {};
    for (const t of raw[m][c.id] ?? []) { const lab = classify(c.labels, t, c.aliases); d[lab] = (d[lab] ?? 0) + 1; if (lab === 'other') others.push(`${c.id}/${m}: ${JSON.stringify(t)}`); }
    dists[m] = d;
  }
  const js = models.slice(1).map((m) => { const al = alignDistributions(dists['gpt-6-luna'], dists[m]); return jensenShannon(al.a, al.b); });
  rows.push({ id: c.id, H: H(dists['gpt-6-luna']), js, minJs: Math.min(...js), dists });
}
rows.sort((a, b) => b.H + 2 * b.minJs - (a.H + 2 * a.minJs));
for (const r of rows) {
  const fmt = (d: Record<string, number>) => Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`${r.id.padEnd(14)} H=${r.H.toFixed(2)} js=[${r.js.map((x: number) => x.toFixed(2)).join(',')}] | L6 ${fmt(r.dists['gpt-6-luna'])} | 5.6 ${fmt(r.dists['gpt-5.6-luna'])} | n5 ${fmt(r.dists['gpt-5-nano'])} | n54 ${fmt(r.dists['gpt-5.4-nano'])}`);
}
console.log('\nOTHER answers:', others.length); console.log(others.slice(0, 60).join('\n'));
