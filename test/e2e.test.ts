import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type IO, main } from '../src/cli.js';
import { type MockHandle, type MockKind, startMock } from '../src/mock/server.js';

const KEY = 'sk-relaycheck-test-key-0123456789abcdef';
const REF = resolve(__dirname, '..', 'refs', 'mock-honest.json');
const REF_OPENAI = resolve(__dirname, '..', 'refs', 'mock-honest-openai.json');
const SAMPLES = '12';
const dir = mkdtempSync(join(tmpdir(), 'relaycheck-'));
mkdirSync(join(dir, 'refs'), { recursive: true });

const mocks: Partial<Record<MockKind, MockHandle>> = {};
beforeAll(async () => {
  for (const kind of ['honest', 'swap', 'inject', 'truncate'] as MockKind[]) mocks[kind] = await startMock({ kind, port: 0, seed: 7 });
});
afterAll(async () => {
  await Promise.all(Object.values(mocks).map((m) => m!.close()));
});

async function run(args: string[], env: Record<string, string> = { RELAY_KEY: KEY, NO_COLOR: '1' }) {
  let out = '';
  let err = '';
  const io: IO = { stdout: (s) => (out += s), stderr: (s) => (err += s), env, isTTY: false, cwd: dir };
  const code = await main(args, io);
  return { code, out, err };
}

function check(kind: MockKind, extra: string[] = []) {
  const json = join(dir, `${kind}-${extra.join('_').replace(/\W+/g, '')}.json`);
  return run([mocks[kind]!.url, '--model', 'mock-sonnet', '--ref', REF, '--samples', SAMPLES, '--lang', 'en', '--json', json, ...extra]).then((r) => ({
    ...r,
    json,
    report: JSON.parse(readFileSync(json, 'utf8')),
  }));
}

const group = (report: any, id: string) => report.groups.find((g: any) => g.id === id);

describe('end-to-end against the mock relay', () => {
  it('honest (anthropic, auto-detect) → exit 0, consistent', async () => {
    const card = join(dir, 'honest.svg');
    const html = join(dir, 'honest.html');
    const r = await check('honest', ['--card', card, '--html', html]);
    expect(r.code).toBe(0);
    expect(r.report.verdict).toBe('consistent');
    expect(r.report.target.api).toBe('anthropic');
    expect(r.out).toMatch(/^CONSISTENT/);
    expect(r.out).not.toMatch(/\x1b\[/); // NO_COLOR respected
    for (const g of r.report.groups) expect(g.status).toBe('pass');
    const svg = readFileSync(card, 'utf8');
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('一致');
    expect(svg).toContain('CONSISTENT');
    expect(svg).not.toContain('127.0.0.1');
    expect(readFileSync(html, 'utf8')).not.toContain('127.0.0.1');
  });

  it('honest over OpenAI chat and Responses → exit 0', async () => {
    for (const api of ['openai', 'responses']) {
      const r = await check('honest', ['--api', api]);
      expect(r.code, r.out + r.err).toBe(0);
      expect(r.report.verdict).toBe('consistent');
      expect(r.report.target.api).toBe(api);
    }
  });

  it('swap → exit 1 with identity fail', async () => {
    const r = await check('swap', ['--probes', 'identity,protocol']);
    expect(r.code).toBe(1);
    expect(r.report.verdict).toBe('inconsistent');
    expect(group(r.report, 'identity').status).toBe('fail');
    expect(group(r.report, 'protocol').status).toBe('pass');
    expect(r.report.pValue).toBeLessThan(0.001);
    expect(r.out).toMatch(/does not behave like mock-sonnet/);
  });

  it('swap over OpenAI protocol is also caught', async () => {
    const r = await check('swap', ['--api', 'openai', '--probes', 'identity']);
    expect(r.code).toBe(1);
    expect(group(r.report, 'identity').status).toBe('fail');
  });

  it('inject → billing fail reporting the injected token count', async () => {
    const r = await check('inject');
    expect(r.code).toBe(1);
    const b = group(r.report, 'billing');
    expect(b.status).toBe('fail');
    expect(r.report.injectedTokens).toBe(512);
    expect(b.results[0].evidence.injectedTokens).toBe(512);
    expect(group(r.report, 'identity').status).toBe('pass');
    expect(r.out).toMatch(/\+512 hidden input tokens per request/);
  });

  it('inject over OpenAI without a baseline for that protocol → local estimate, labelled uncalibrated', async () => {
    const r = await check('inject', ['--api', 'openai', '--probes', 'billing']);
    expect(r.code).toBe(1);
    expect(r.report.injectedTokens).toBe(512);
    const ev = group(r.report, 'billing').results[0].evidence;
    expect(ev.method).toBe('local_estimate');
    expect(ev.calibrated).toBe(false);
  });

  it('inject over OpenAI with the reference baseline → exact count, calibrated', async () => {
    const json = join(dir, 'inject-exact.json');
    const r = await run([mocks.inject!.url, '--model', 'mock-sonnet', '--api', 'openai', '--ref', REF_OPENAI, '--probes', 'billing', '--lang', 'en', '--json', json]);
    expect(r.code).toBe(1);
    const rep = JSON.parse(readFileSync(json, 'utf8'));
    const ev = group(rep, 'billing').results[0].evidence;
    expect(ev.method).toBe('reference_baseline');
    expect(ev.analysis.kind).toBe('constant');
    expect(rep.injectedTokens).toBe(512);
    expect(r.out).toMatch(/exactly 512 extra input tokens/);
  });

  it('honest over OpenAI with the reference baseline → billing matches exactly', async () => {
    const json = join(dir, 'honest-exact.json');
    const r = await run([mocks.honest!.url, '--model', 'mock-sonnet', '--api', 'responses', '--ref', REF_OPENAI, '--probes', 'billing', '--lang', 'en', '--json', json]);
    expect(r.code).toBe(0);
    expect(group(JSON.parse(readFileSync(json, 'utf8')), 'billing').results[0].evidence.analysis.kind).toBe('match');
  });

  it('an old v1 reference still runs, with a regenerate warning (exit 2 when otherwise consistent)', async () => {
    const v1 = join(dir, 'refs', 'v1.json');
    const fp = await run(['fingerprint', mocks.honest!.url, '--model', 'mock-sonnet', '--samples', '30', '--out', v1, '--quiet']);
    expect(fp.code).toBe(0);
    // rewrite it into the 0.1 format: v1 prompts, no version / sampling / billing
    const { PROBE_SET_V1 } = await import('../src/probes/probesets.js');
    const { personaDistribution } = await import('../src/mock/distributions.js');
    const old = { model: 'mock-sonnet', api: 'anthropic', created: '', samples: 200, probes: PROBE_SET_V1.probes.map((p) => ({ id: p.id, prompt: p.prompt, dist: Object.fromEntries(Object.entries(personaDistribution(p.id, 'honest')!).map(([k, v]) => [k, Math.round(v * 200)])) })) };
    writeFileSync(v1, JSON.stringify(old));
    const json = join(dir, 'v1-check.json');
    const r = await run([mocks.honest!.url, '--model', 'mock-sonnet', '--ref', v1, '--probes', 'identity', '--samples', '12', '--lang', 'en', '--json', json]);
    const rep = JSON.parse(readFileSync(json, 'utf8'));
    const compat = group(rep, 'identity').results.find((x: any) => x.id === 'identity.ref_compat');
    expect(compat.status).toBe('warn');
    expect(compat.detail.en).toMatch(/older probe set v1/);
    expect(rep.reference.probeSetVersion).toBe(1);
    expect(r.code).toBe(2);
  });

  it('a reference with an unknown probe-set version or edited prompts is a runtime error (exit 3)', async () => {
    const bad = join(dir, 'refs', 'bad.json');
    const ref = JSON.parse(readFileSync(REF, 'utf8'));
    writeFileSync(bad, JSON.stringify({ ...ref, probeSetVersion: 99 }));
    expect((await run([mocks.honest!.url, '--model', 'mock-sonnet', '--ref', bad, '--probes', 'identity'])).code).toBe(3);
    ref.probes[0].prompt += ' (edited)';
    writeFileSync(bad, JSON.stringify(ref));
    const r = await run([mocks.honest!.url, '--model', 'mock-sonnet', '--ref', bad, '--probes', 'identity']);
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/does not match probe set v2/);
  });

  it('truncate → context fail', async () => {
    const r = await check('truncate');
    expect(r.code).toBe(1);
    expect(group(r.report, 'context').status).toBe('fail');
    expect(group(r.report, 'identity').status).toBe('pass');
    expect(group(r.report, 'billing').status).toBe('pass');
    expect(r.out).toMatch(/context truncated/);
  });

  it('never prints or writes the key', async () => {
    const r = await check('inject', ['--probes', 'billing', '--lang', 'zh']);
    expect(r.out + r.err).not.toContain(KEY);
    expect(readFileSync(r.json, 'utf8')).not.toContain(KEY);
  });

  it('no reference → uncalibrated, exit 2', async () => {
    const r = await run([mocks.honest!.url, '--model', 'unknown-model', '--probes', 'identity', '--lang', 'en']);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/UNCALIBRATED/);
  });

  it('runtime errors → exit 3', async () => {
    expect((await run([mocks.honest!.url, '--model', 'm', '--key', 'sk-x'])).code).toBe(3);
    expect((await run(['https://relay.example.invalid', '--model', 'm'], {})).code).toBe(3);
    expect((await run(['http://127.0.0.1:1', '--model', 'm', '--api', 'openai', '--timeout', '2'])).code).toBe(3);
  });

  it('fingerprint command writes a loadable reference', async () => {
    const out = join(dir, 'refs', 'fp.json');
    const r = await run(['fingerprint', mocks.honest!.url, '--model', 'mock-sonnet', '--samples', '4', '--out', out, '--quiet']);
    expect(r.code, r.err).toBe(0);
    const ref = JSON.parse(readFileSync(out, 'utf8'));
    expect(ref.model).toBe('mock-sonnet');
    expect(ref.probes).toHaveLength(24);
    expect(ref.probeSetVersion).toBe(2);
    expect(ref.billing.anthropic.prompts.map((p: any) => p.id)).toEqual(['b1', 'b4', 'b12', 'tokenizer']);
    expect(ref.sampling).toMatchObject({ api: 'anthropic', temperature: 1 });
    expect(ref.dispersion).toBeUndefined(); // < 40 samples: a single block
  });

  it('fingerprint with ≥40 samples samples 4 time blocks and stores the dispersion', async () => {
    const out = join(dir, 'refs', 'fp40.json');
    const r = await run(['fingerprint', mocks.honest!.url, '--model', 'mock-sonnet', '--api', 'openai', '--samples', '40', '--out', out, '--quiet', '--concurrency', '8']);
    expect(r.code, r.err).toBe(0);
    const ref = JSON.parse(readFileSync(out, 'utf8'));
    expect(ref.dispersion.blocks).toBe(4);
    expect(ref.dispersion.phi).toBeGreaterThan(0.5);
    expect(ref.dispersion.phi).toBeLessThan(1.6);
    expect(Object.keys(ref.billing).sort()).toEqual(['openai', 'responses']);
    expect(Object.values(ref.probes[0].dist).reduce((a: number, b: any) => a + b, 0)).toBe(40);
  });
});
