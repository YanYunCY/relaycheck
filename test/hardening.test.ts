import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError, backoffDelay, isRetryableStatus, parseSse, postJson, retryAfterMs } from '../src/api/http.js';
import { OpenAIChatAdapter } from '../src/api/openai.js';
import { parseResponsesObject } from '../src/api/responses.js';
import type { Adapter, ChatRequest, ChatResponse } from '../src/api/types.js';
import { validateRef, type RefFingerprint } from '../src/fingerprint.js';
import { BASELINE_PROMPTS, analyzeExact, usableBaseline } from '../src/probes/billing.js';
import { classify, normalizeAnswer } from '../src/probes/classify.js';
import type { ProbeContext } from '../src/probes/common.js';
import { buildHaystack, containsPassphrase, runContext } from '../src/probes/context.js';
import { refCompatibility, scoreIdentity } from '../src/probes/identity.js';
import { CURRENT_PROBE_SET, PROBE_SET_V1, PROBE_SETS } from '../src/probes/probesets.js';
import { Redactor } from '../src/redact.js';
import { promptHash } from '../src/rng.js';
import { buildReport, meter } from '../src/run.js';
import { cauchyCombination } from '../src/stats.js';

describe('answer normalization', () => {
  const L5 = ['a', 'b', 'c', 'd', 'e'];
  const cases: [string[], string, string, Record<string, string[]>?][] = [
    [L5, "I'd go with C", 'c'], // was "d" (the contraction) before 0.2
    [L5, 'a C', 'c'], // article "a" is not the answer
    [L5, 'C or D', 'other'], // ambiguous
    [L5, '**C**', 'c'],
    [L5, '"c"', 'c'],
    [L5, 'Letter C', 'c'],
    [L5, 'A.', 'a'],
    [L5, 'The answer is B', 'b'],
    [L5, '<think>maybe a</think>E', 'e'], // leaked reasoning ignored
    [L5, '<think>still thinking about a', 'other'], // unterminated reasoning: no answer
    [L5, 'a dog ran across the field quickly', 'other'], // long free text is not a letter choice
    [['0', '1', '7'], '７', '7'], // full width
    [['0', '1', '7'], 'Seven', '7'],
    [['0', '1', '7'], '七', '7'],
    [['0', '1', '7'], '7️⃣', '7'],
    [['red', 'blue'], 'Blue!', 'blue'],
    [['red', 'blue'], '蓝色', 'blue', { blue: ['蓝'] }],
    [['red', 'blue'], 'I pick blue, not red', 'blue'],
    [['red', 'blue'], 'reddish', 'other'],
    [['spring', 'autumn'], 'Fall', 'autumn', { autumn: ['fall'] }],
    [['north america', 'asia'], 'North America.', 'north america'],
    [['红', '蓝'], '我选蓝色。', '蓝'],
    [['java', 'javascript'], 'JavaScript', 'javascript'],
    [['hhh', 'hth'], 'H-T-H', 'hth', { hth: ['h-t-h'] }],
    [['a', '10', 'k'], 'Ace', 'a', { a: ['ace'] }],
    [['a', '10', 'k'], '10', '10'],
    [['cat', 'dog'], '', 'other'],
  ];
  for (const [labels, text, want, aliases] of cases)
    it(`${JSON.stringify(text)} → ${want}`, () => expect(classify(labels, text, aliases)).toBe(want));
  it('normalizes quotes, markdown and lead-ins', () => {
    expect(normalizeAnswer('  **Answer:** “Blue”. ')).toBe('blue');
    expect(normalizeAnswer('我选：蓝')).toBe('蓝');
  });
  it('every probe label of every probe set classifies to itself, also capitalized', () => {
    for (const set of PROBE_SETS)
      for (const p of set.probes)
        for (const lab of p.labels) {
          expect(classify(p.labels, lab, p.aliases)).toBe(lab);
          expect(classify(p.labels, `${lab.toUpperCase()}.`, p.aliases)).toBe(lab);
        }
  });
});

describe('probe sets', () => {
  it('v2 has ≤24 probes with unique ids and ≥2 labels each', () => {
    expect(CURRENT_PROBE_SET.version).toBe(2);
    expect(CURRENT_PROBE_SET.probes.length).toBeLessThanOrEqual(24);
    expect(new Set(CURRENT_PROBE_SET.probes.map((p) => p.id)).size).toBe(CURRENT_PROBE_SET.probes.length);
    for (const p of CURRENT_PROBE_SET.probes) expect(p.labels.length).toBeGreaterThanOrEqual(2);
  });
  const ref = (over: Partial<RefFingerprint> = {}): RefFingerprint => ({
    model: 'm',
    api: 'responses',
    created: '',
    samples: 10,
    probeSetVersion: 2,
    probes: CURRENT_PROBE_SET.probes.map((p) => ({ id: p.id, prompt: p.prompt, dist: { [p.labels[0]]: 10 } })),
    ...over,
  });
  it('accepts a matching v2 reference without problems', () => {
    const c = refCompatibility(ref(), { api: 'responses' });
    expect(c.set.version).toBe(2);
    expect(c.problems).toEqual([]);
  });
  it('reads an old (unversioned) v1 reference with its own probe definitions and a warning', () => {
    const v1 = ref({ probeSetVersion: undefined, probes: PROBE_SET_V1.probes.map((p) => ({ id: p.id, prompt: p.prompt, dist: { [p.labels[0]]: 10 } })) });
    const c = refCompatibility(v1, { api: 'responses' });
    expect(c.set.version).toBe(1);
    expect(c.problems[0].en).toMatch(/older probe set v1/);
  });
  it('rejects unknown versions and edited prompts', () => {
    expect(() => refCompatibility(ref({ probeSetVersion: 99 }), { api: 'responses' })).toThrow(/probe set v99/);
    const r = ref();
    r.probes[0] = { ...r.probes[0], prompt: r.probes[0].prompt + ' ' };
    expect(() => refCompatibility(r, { api: 'responses' })).toThrow(/does not match probe set v2/);
  });
  it('flags a reasoning-effort mismatch as a problem and a protocol mismatch as a note', () => {
    const c = refCompatibility(ref({ sampling: { api: 'responses', temperature: 1, maxTokens: 16, reasoningEffort: 'none' } }), { api: 'openai' });
    expect(c.problems).toHaveLength(1);
    expect(c.problems[0].en).toMatch(/reasoning effort/);
    expect(c.notes).toHaveLength(1);
  });
  it('validateRef checks the new fields', () => {
    expect(() => validateRef({ ...ref(), probeSetVersion: 'x' })).toThrow(/probeSetVersion/);
    expect(() => validateRef({ ...ref(), billing: { openai: { prompts: [{ id: 'b1' }] } } })).toThrow(/billing/);
  });
});

describe('identity scoring', () => {
  const refp: { probes: { id: string; prompt: string; dist: Record<string, number> }[] } = { probes: [
    { id: 'p1', prompt: '', dist: { x: 100 } },
    { id: 'p2', prompt: '', dist: { a: 50, b: 50 } },
    { id: 'p3', prompt: '', dist: { a: 90, b: 10 } },
  ] };
  it('drops df=0 probes, is independent of probe order and seeded', () => {
    const obs: { id: string; dist: Record<string, number>; errors: number }[] = [
      { id: 'p1', dist: { x: 24 }, errors: 0 },
      { id: 'p2', dist: { a: 12, b: 12 }, errors: 0 },
      { id: 'p3', dist: { a: 20, b: 4 }, errors: 0 },
    ];
    const s1 = scoreIdentity(obs, refp, 5);
    const s2 = scoreIdentity([...obs].reverse(), refp, 5);
    expect(s1.informative).toBe(2);
    expect(s1.pValue).toBe(s2.pValue);
    expect(s1.status).toBe('pass');
  });
  it('a pass with >20% failed requests becomes warn; an empty run is warn', () => {
    const s = scoreIdentity([{ id: 'p2', dist: { a: 6, b: 6 }, errors: 12 }], refp, 1, {}, 24);
    expect(s.errorRate).toBe(0.5);
    expect(s.status).toBe('warn');
    expect(scoreIdentity([{ id: 'p2', dist: {}, errors: 24 }], refp, 1).pValue).toBeNull();
  });
  it('one-hot reference vs a different one-hot answer fails without the asymptotic tail', () => {
    const s = scoreIdentity([{ id: 'p1', dist: { y: 24 }, errors: 0 }], refp, 1);
    expect(s.stats[0].method).toBe('mc-floor');
    expect(s.status).toBe('fail');
  });
  it('Cauchy: a single probe at the MC floor among 24 still fails', () => {
    expect(cauchyCombination([1 / 200001, ...Array(23).fill(0.5)])).toBeLessThan(0.001);
  });
});

describe('billing: exact baseline analysis', () => {
  const s = (pairs: [number, number][]) => pairs.map(([b, x]) => ({ baseline: b, billed: x, excess: x - b }));
  it('exact match passes', () => expect(analyzeExact(s([[99, 99], [343, 344], [993, 992]]))!.kind).toBe('match'));
  it('constant excess is a hidden prompt (fail ≥16, warn below)', () => {
    const a = analyzeExact(s([[99, 611], [343, 855], [993, 1505]]))!;
    expect(a).toMatchObject({ status: 'fail', excess: 512, kind: 'constant' });
    expect(analyzeExact(s([[99, 107], [343, 351], [993, 1001]]))!.status).toBe('warn');
  });
  it('proportional excess = different tokenizer', () => {
    const a = analyzeExact(s([[99, 120], [343, 415], [993, 1200]]))!;
    expect(a.kind).toBe('proportional');
    expect(a.slope).toBeGreaterThan(1.1);
  });
  it('under-billing is flagged', () => expect(analyzeExact(s([[99, 80], [343, 324], [993, 974]]))!.kind).toBe('under'));
  it('no usage → null', () => expect(analyzeExact([{ baseline: 1, billed: null, excess: null }])).toBeNull());
  it('baseline is used only for the same model and unchanged prompts', () => {
    const prompts = BASELINE_PROMPTS.map((p) => ({ id: p.id, hash: promptHash(p.text), inputTokens: 10 }));
    const ref = { model: 'm', billing: { openai: { prompts, measuredAt: '' } } } as unknown as RefFingerprint;
    const adapter = { kind: 'openai' } as Adapter;
    expect(usableBaseline({ ref, model: 'm', adapter })).not.toBeNull();
    expect(usableBaseline({ ref, model: 'other', adapter })).toBeNull();
    expect(usableBaseline({ ref, model: 'm', adapter: { kind: 'responses' } as Adapter })).toBeNull();
    const stale = { ...ref, billing: { openai: { prompts: prompts.map((p) => ({ ...p, hash: 'deadbeef' })), measuredAt: '' } } } as RefFingerprint;
    expect(usableBaseline({ ref: stale, model: 'm', adapter })).toBeNull();
  });
});

describe('context probe', () => {
  it('matches passphrases despite formatting', () => {
    expect(containsPassphrase('**rc–1a2b3c**', 'RC-1A2B3C')).toBe(true);
    expect(containsPassphrase('RC 1A2B3C', 'RC-1A2B3C')).toBe(true);
    expect(containsPassphrase('RC-1A2B3D', 'RC-1A2B3C')).toBe(false);
  });
  it('places all needles at their depths', () => {
    const h = buildHaystack(4000, ['RC-1', 'RC-2', 'RC-3'], [0.1, 0.5, 0.9], 3);
    const at = ['RC-1', 'RC-2', 'RC-3'].map((p) => h.indexOf(p) / h.length);
    expect(at[0]).toBeGreaterThan(0.05);
    expect(at[0]).toBeLessThan(0.15);
    expect(at[1]).toBeGreaterThan(0.45);
    expect(at[2]).toBeGreaterThan(0.85);
  });
  function fakeCtx(answer: (doc: string, call: number) => Partial<ChatResponse>): ProbeContext {
    let call = 0;
    const adapter = {
      kind: 'openai',
      chat: async (req: ChatRequest) => {
        const doc = String(req.messages[0].content);
        const r = answer(doc, call++);
        return { text: '', toolCalls: [], thinking: [], stopReason: 'end', rawStopReason: 'stop', model: 'm', usage: { input: 1, output: 1, cacheRead: null, cacheWrite: null }, raw: {}, ...r } as ChatResponse;
      },
    } as unknown as Adapter;
    return { adapter, model: 'm', samples: 1, concurrency: 1, ref: null, deep: false, seed: 1, log: () => {} };
  }
  const all = (doc: string) => [...doc.matchAll(/is (RC-[0-9A-F]+)\./g)].map((m) => m[1]);
  it('an answer cut off by max_tokens is inconclusive, not truncation', async () => {
    const g = await runContext(fakeCtx((doc) => (doc.length > 20000 ? { text: '', stopReason: 'max_tokens', rawStopReason: 'length' } : { text: all(doc).join(' ') })));
    expect(g.status).toBe('warn');
  });
  it('a single recall slip that recovers on retry passes', async () => {
    let slipped = false;
    const g = await runContext(fakeCtx((doc) => {
      const p = all(doc);
      if (doc.length > 20000 && !slipped) {
        slipped = true;
        return { text: p.slice(0, 2).join(' ') };
      }
      return { text: p.join(' ') };
    }));
    expect(g.status).toBe('pass');
  });
  it('the same depth missing twice is truncation', async () => {
    const g = await runContext(fakeCtx((doc) => ({ text: all(doc).slice(0, doc.length > 20000 ? 1 : 3).join(' ') })));
    expect(g.status).toBe('fail');
    expect((g.results[0].evidence as any).missedDepths).toBe('50%/90%');
  });
});

describe('SSE parser edge cases', () => {
  it('handles CRLF, lone CR, BOM, field without colon, no trailing blank line', () => {
    expect(parseSse('\uFEFFevent: a\r\ndata: 1\r\n\r\nevent: b\rdata: 2\r\rdata\n\ndata: tail')).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
      { event: null, data: '' },
      { event: null, data: 'tail' },
    ]);
  });
  it('joins multi-line data and keeps leading spaces beyond the first', () => {
    expect(parseSse('data: x\ndata:  y\n\n')).toEqual([{ event: null, data: 'x\n y' }]);
  });
  it('ignores comments / keep-alives', () => {
    expect(parseSse(': ping\n\n: ping\n\ndata: [DONE]\n\n')).toEqual([{ event: null, data: '[DONE]' }]);
  });
});

describe('HTTP retries', () => {
  it('classifies retryable statuses', () => {
    for (const s of [408, 409, 425, 429, 500, 502, 503, 529]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 413, 422]) expect(isRetryableStatus(s)).toBe(false);
  });
  it('parses Retry-After seconds, dates and retry-after-ms', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '2' }))).toBe(2000);
    expect(retryAfterMs(new Headers({ 'retry-after-ms': '150' }))).toBe(150);
    expect(retryAfterMs(new Headers({ 'retry-after': new Date(10_000).toUTCString() }), 7000)).toBe(3000);
    expect(retryAfterMs(new Headers({ 'retry-after': 'soon' }))).toBeNull();
  });
  it('backoff has jitter within [d/2, d]', () => {
    expect(backoffDelay(2, 100, () => 0)).toBe(200);
    expect(backoffDelay(2, 100, () => 0.999999)).toBe(400);
  });

  let server: Server;
  let url = '';
  let hits: Record<string, number> = {};
  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? '';
      hits[path] = (hits[path] ?? 0) + 1;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const n = hits[path];
        const json = (status: number, b: unknown, h: Record<string, string> = {}) => {
          res.writeHead(status, { 'content-type': 'application/json', ...h });
          res.end(JSON.stringify(b));
        };
        if (path === '/flaky') return n < 3 ? json(429, { error: 'slow down' }, { 'retry-after-ms': '20' }) : json(200, { ok: n });
        if (path === '/bad') return json(401, { error: 'nope' });
        if (path === '/always503') return json(503, { error: 'down' });
        if (path === '/v1/chat/completions') {
          const b = JSON.parse(body);
          if ('max_tokens' in b) return json(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } });
          if ('temperature' in b) return json(400, { error: { message: "Unsupported value: 'temperature' does not support 0" } });
          return json(200, { model: b.model, choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
        }
        json(404, {});
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const opts = { timeoutMs: 5000, retries: 3, backoffMs: 1 };
  it('retries 429 honouring retry-after-ms, then succeeds', async () => {
    expect(await postJson(`${url}/flaky`, {}, {}, opts)).toEqual({ ok: 3 });
  });
  it('does not retry 401', async () => {
    await expect(postJson(`${url}/bad`, {}, {}, opts)).rejects.toBeInstanceOf(HttpError);
    expect(hits['/bad']).toBe(1);
  });
  it('gives up after retries+1 attempts and surfaces the HTTP status', async () => {
    await expect(postJson(`${url}/always503`, {}, {}, opts)).rejects.toMatchObject({ status: 503 });
    expect(hits['/always503']).toBe(4);
  });
  it('OpenAI adapter adapts to BOTH max_completion_tokens and temperature quirks in one call', async () => {
    const a = new OpenAIChatAdapter({ baseUrl: `${url}/v1`, key: '', ...opts });
    const r = await a.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 8, temperature: 0 });
    expect(r.text).toBe('OK');
  });
});

describe('protocol parsing', () => {
  it('Responses refusals are surfaced as text, incomplete → max_tokens', () => {
    const r = parseResponsesObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], usage: { input_tokens: 5 } });
    expect(r.text).toBe('no');
    expect(r.stopReason).toBe('max_tokens');
  });
});

describe('redaction', () => {
  const r = new Redactor();
  r.add('sk-live-registered-0123456789');
  it('masks registered and pattern keys', () => {
    const out = r.redact('k=sk-live-registered-0123456789 sk-proj-ABCDEFGHIJKLMNOPQRSTUV AIzaSyA0123456789abcdefghijklmnopqrstu ghp_0123456789abcdefghijABCDEFGHIJ');
    expect(out).not.toMatch(/registered|ABCDEFGHIJKLMNOP|SyA0123456789|abcdefghijABCD/);
  });
  it('masks header-like and URL credentials', () => {
    expect(r.redact('{"x-api-key": "abcdefghijkl"}')).not.toContain('abcdefghijkl');
    expect(r.redact('https://user:hunter22@relay.example/v1')).not.toContain('hunter22');
    expect(r.redact('https://r.example/v1?api-key=abcdefgh')).not.toContain('abcdefgh');
    expect(r.redactDeep({ Cookie: 'session=1', 'Proxy-Authorization': 'Basic x' })).toEqual({ Cookie: '[REDACTED]', 'Proxy-Authorization': '[REDACTED]' });
  });
});

describe('report', () => {
  const opts = { baseUrl: 'http://x', model: 'm', api: 'openai', key: '', samples: 1, probes: [], ref: null, refPath: null, deep: false, concurrency: 1, timeoutMs: 1, seed: 1, log: () => {} } as any;
  it('a consistent headline only claims what was checked', () => {
    const rep = buildReport({ groups: [{ id: 'protocol', status: 'pass', summary: { zh: '', en: '' }, results: [] }], opts, baseUrl: 'http://x', api: 'openai', started: Date.now() });
    expect(rep.headline.en).toBe('CONSISTENT: no protocol anomalies');
    expect(rep.headline.en).not.toMatch(/behaves like/);
    expect(rep.exitCode).toBe(0);
  });
  it('meter counts requests and tokens', async () => {
    const base = { kind: 'openai', chat: async () => ({ usage: { input: 10, output: 2 } }), stream: async () => ({ usage: { input: 5, output: null } }) } as unknown as Adapter;
    const { adapter, usage } = meter(base);
    await adapter.chat({} as ChatRequest);
    await adapter.stream({} as ChatRequest);
    expect(usage).toEqual({ requests: 2, inputTokens: 15, outputTokens: 2 });
  });
});
