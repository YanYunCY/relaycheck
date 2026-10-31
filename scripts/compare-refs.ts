/** Offline pairwise distance between reference fingerprints (no API calls).
 *   npx vite-node scripts/compare-refs.ts refs/a.json refs/b.json ... */
import { loadRef } from '../src/fingerprint.js';
import { homogeneityTest, cauchyCombination, jensenShannon, normalize, formatP } from '../src/stats.js';
const files = process.argv.slice(2).filter((a) => a !== '--');
const refs = files.map((f) => loadRef(f));
let seed = 7; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) {
  const A = refs[i], B = refs[j]; const ps: number[] = []; let js = 0, n = 0; const diffs: [string, number][] = [];
  for (const pa of A.probes) {
    const pb = B.probes.find((x) => x.id === pa.id); if (!pb) continue;
    const keys = [...new Set([...Object.keys(pa.dist), ...Object.keys(pb.dist)])];
    const a = keys.map((k) => pa.dist[k] ?? 0), b = keys.map((k) => pb.dist[k] ?? 0);
    const t = homogeneityTest(a, b, rng); if (t.df > 0) ps.push(Math.min(t.p, 0.99));
    const d = jensenShannon(normalize(a), normalize(b)); js += d; n++; diffs.push([pa.id, d]);
  }
  diffs.sort((x, y) => y[1] - x[1]);
  console.log(`${A.model} vs ${B.model}: p=${formatP(cauchyCombination(ps))} meanJS=${(js / n).toFixed(3)} top=${diffs.slice(0, 3).map((d) => d[0]).join(',')}`);
}
