/**
 * Estimate the endpoint's over-dispersion φ from collected official samples split into time
 * blocks and store it in a reference file (no API calls).
 *   npx vite-node scripts/set-dispersion.ts -- --ref refs/gpt-6-luna.json --raw calib/raw/fpr-gpt-6-luna.jsonl [--block 24] [--write]
 */
import { readFileSync } from 'node:fs';
import { loadRef, saveRef } from '../src/fingerprint.js';
import { classify } from '../src/probes/classify.js';
import { probeSet } from '../src/probes/probesets.js';
import { estimateDispersion } from '../src/stats.js';
const argv = process.argv.slice(2).filter((a) => a !== '--');
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const refPath = arg('ref', 'refs/gpt-6-luna.json');
const raw = arg('raw', '');
const block = Number(arg('block', '24'));
const ref = loadRef(refPath);
const set = probeSet(ref.probeSetVersion ?? 1)!;
const by: Record<string, string[]> = {};
for (const line of readFileSync(raw, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  const def = set.probes.find((p) => p.id === r.probe);
  if (def && !r.error) (by[r.probe] ??= []).push(classify(def.labels, r.text, def.aliases));
}
let blocks = 0;
const est = estimateDispersion(ref.probes.map((rp) => {
  const labs = by[rp.id] ?? [];
  const uni = [...new Set(labs)];
  const nb = Math.floor(labs.length / block);
  blocks = nb;
  return Array.from({ length: nb }, (_, b) => uni.map((u) => labs.slice(b * block, (b + 1) * block).filter((x) => x === u).length));
}));
console.log(JSON.stringify(est));
if (argv.includes('--write')) {
  ref.dispersion = { phi: +est.phi.toFixed(3), df: est.df, blocks, source: `${blocks} time blocks x ${block} extra official samples per probe (${raw})` };
  saveRef(refPath, ref);
  console.log(`wrote dispersion to ${refPath}`);
}
