// Regenerates the SYNTHETIC reference fingerprints in refs/ from the mock "honest" relay.
// These are NOT fingerprints of any real model; they exist for demos and tests only.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const SAMPLES = 200;
const targets = [
  { file: 'refs/mock-honest.json', api: 'anthropic', port: 18901 },
  { file: 'refs/mock-honest-openai.json', api: 'openai', port: 18902 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const t of targets) {
  const mock = spawn(process.execPath, ['dist/cli.js', 'mock', '--kind', 'honest', '--port', String(t.port), '--seed', '20261031'], { stdio: 'ignore' });
  await sleep(400);
  const fp = spawn(process.execPath, ['dist/cli.js', 'fingerprint', `http://127.0.0.1:${t.port}`, '--model', 'mock-sonnet', '--api', t.api, '--samples', String(SAMPLES), '--out', t.file, '--quiet', '--concurrency', '16'], { stdio: 'inherit' });
  const code = await new Promise((r) => fp.on('exit', r));
  mock.kill('SIGTERM');
  if (code !== 0) process.exit(code);
  const ref = JSON.parse(readFileSync(t.file, 'utf8'));
  ref.synthetic = true;
  ref.note = 'SYNTHETIC reference generated from the relaycheck mock "honest" distribution (mock-sonnet). Not a real model fingerprint — for demos and tests only.';
  ref.created = '2026-10-31T00:00:00.000Z';
  writeFileSync(t.file, JSON.stringify({ model: ref.model, api: ref.api, created: ref.created, samples: ref.samples, probeSetVersion: ref.probeSetVersion, sampling: ref.sampling, dispersion: ref.dispersion, synthetic: true, note: ref.note, probes: ref.probes, billing: ref.billing }, null, 2) + '\n');
}
