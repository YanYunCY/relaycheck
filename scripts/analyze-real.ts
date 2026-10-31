/**
 * Split collected raw answers (calib/raw/<tag>-<model>.jsonl) into independent runs of
 * `testN` samples per probe and score each run against a reference exactly as the CLI does.
 *   npx vite-node scripts/analyze-real.ts -- --ref refs/gpt-6-luna.json --raw calib/raw/fpr-gpt-6-luna.jsonl [--testN 24] [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRef } from '../src/fingerprint.js';
import { classify } from '../src/probes/classify.js';
import { FAIL_P, WARN_P, scoreIdentity } from '../src/probes/identity.js';
import { probeSet } from '../src/probes/probesets.js';
import { formatP } from '../src/stats.js';
import { CANDIDATES } from './candidates.js';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ref = loadRef(arg('ref', 'refs/gpt-6-luna.json'));
const set = probeSet(ref.probeSetVersion ?? 1)!;
const testN = Number(arg('testN', '24'));
const maxRuns = Number(arg('runs', '1000'));
const byProbe: Record<string, { lab: string; err: boolean }[]> = {};
for (const line of readFileSync(arg('raw', ''), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  // screening files use candidate ids: map them through the prompt text
  const cand = CANDIDATES.find((c) => c.id === r.probe);
  const def = set.probes.find((p) => p.id === r.probe) ?? (cand ? set.probes.find((p) => p.prompt === cand.prompt) : undefined);
  if (!def) continue;
  (byProbe[def.id] ??= []).push(r.error ? { lab: '', err: true } : { lab: classify(def.labels, r.text, def.aliases), err: false });
}
const runs = Math.min(maxRuns, Math.min(...ref.probes.map((p) => Math.floor((byProbe[p.id]?.length ?? 0) / testN))));
const out: { run: number; p: number | null; status: string; worst: string[] }[] = [];
const probeP: Record<string, number[]> = {};
for (let k = 0; k < runs; k++) {
  const obs = ref.probes.map((rp) => {
    const chunk = byProbe[rp.id].slice(k * testN, (k + 1) * testN);
    const dist: Record<string, number> = {};
    for (const c of chunk) if (!c.err) dist[c.lab] = (dist[c.lab] ?? 0) + 1;
    return { id: rp.id, dist, errors: chunk.filter((c) => c.err).length };
  });
  const sc = scoreIdentity(obs, ref, 1 + k, {}, testN);
  for (const st of sc.stats) (probeP[st.id] ??= []).push(st.df > 0 ? st.pValue : 1);
  out.push({ run: k, p: sc.pValue, status: sc.status, worst: sc.worst });
}
const ps = out.map((o) => o.p ?? 1);
const allProbeP = Object.values(probeP).flat();
const summary = {
  raw: arg('raw', ''),
  ref: arg('ref', ''),
  testN,
  runs,
  fail: ps.filter((p) => p < FAIL_P).length,
  warn: ps.filter((p) => p >= FAIL_P && p < WARN_P).length,
  pass: ps.filter((p) => p >= WARN_P).length,
  medianP: [...ps].sort((a, b) => a - b)[Math.floor(ps.length / 2)],
  maxP: Math.max(...ps),
  minP: Math.min(...ps),
  probeTests: allProbeP.length,
  probeBelow05: allProbeP.filter((p) => p < 0.05).length,
  probeBelow01: allProbeP.filter((p) => p < 0.01).length,
  probeBelow001: allProbeP.filter((p) => p < 0.001).length,
  lowestProbes: Object.entries(probeP).map(([id, v]) => [id, Math.min(...v)] as [string, number]).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([id, p]) => `${id}:${formatP(p)}`),
  ps: ps.map((p) => +p.toPrecision(3)),
};
console.log(JSON.stringify(summary));
if (arg('json', '')) writeFileSync(arg('json', ''), JSON.stringify({ summary, runs: out, probeP }, null, 2));
