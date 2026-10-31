/**
 * Collect RAW answers for probes from real models (temperature 1), appending to
 * calib/raw/<tag>-<model>.jsonl as {probe, text, at}. Raw text is kept so answer
 * classification can be re-done offline at no cost.
 *   npx vite-node scripts/collect.ts -- <tag> <model> <samplesPerProbe> [probeSet=candidates|current] [block=24] [concurrency=12]
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { pool } from '../src/probes/common.js';
import { IDENTITY_PROBES } from '../src/probes/identity.js';
import { CANDIDATES } from './candidates.js';
import { currentSpend, flushSpend, meteredAdapter } from './lib.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const [tag, model, nStr, set = 'current', blockStr = '24', concStr = '12'] = args;
const n = Number(nStr);
const probes = set === 'candidates' ? CANDIDATES : IDENTITY_PROBES;
const a = meteredAdapter(model, `${tag}:${model}`);
mkdirSync('calib/raw', { recursive: true });
const file = `calib/raw/${tag}-${model}.jsonl`;
// time-ordered like real CLI runs: run 1 = 24 samples of every probe, then run 2, …
const block = Number(blockStr);
const jobs: typeof probes = [];
for (let done = 0; done < n; done += block) for (const p of probes) for (let i = 0; i < Math.min(block, n - done); i++) jobs.push(p);
let errors = 0;
await pool(jobs, Number(concStr), async (p) => {
  try {
    const r = await a.chat({ model, messages: [{ role: 'user', content: p.prompt }], maxTokens: 16, temperature: 1 });
    appendFileSync(file, JSON.stringify({ probe: p.id, text: r.text, stop: r.rawStopReason, at: Date.now() }) + '\n');
  } catch (e) {
    errors++;
    appendFileSync(file, JSON.stringify({ probe: p.id, error: (e as Error).message.slice(0, 200), at: Date.now() }) + '\n');
    if (/BUDGET STOP/.test((e as Error).message)) throw e;
  }
});
flushSpend(`${tag}:${model}`);
console.log(`${model}: ${jobs.length} requests, ${errors} errors → ${file}; total spend so far $${currentSpend().toFixed(4)}`);
