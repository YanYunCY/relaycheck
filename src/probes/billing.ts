import type { ChatRequest } from '../api/types.js';
import { messageText } from '../api/types.js';
import { promptHash, randomHex } from '../rng.js';
import type { BillingBaseline } from '../fingerprint.js';
import { estimatePromptTokens } from '../tokens.js';
import { type CheckResult, type GroupResult, type L10n, l, worstStatus } from '../types.js';
import { type ProbeContext, guard, result } from './common.js';

const PARAGRAPH =
  'Bridges have carried people across rivers and valleys for thousands of years. Early builders used stone arches, ' +
  'timber trusses and rope walkways, each suited to the materials and skills of their time. Engineers later learned ' +
  'to balance tension and compression with iron, steel and concrete, which made longer spans possible. ';

export const TOKENIZER_TEXT =
  'The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳过了懒狗。 function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); } 1234567890 ☃ naïve café';
export const TOKENIZER_PROMPT = `Repeat nothing. Reply OK.\n${TOKENIZER_TEXT}`;

export function billingPrompt(repeats: number, nonce: string): string {
  return `Reference ${nonce}.\n${PARAGRAPH.repeat(repeats)}\nReply with OK.`;
}

export function cachePrefix(nonce: string, targetTokens = 5000): string {
  const parts = [`You are a careful assistant. Session ${nonce}. The following background material is reference only.`];
  let i = 0;
  while (estimatePromptTokens(parts.join('\n'), []) < targetTokens) {
    parts.push(`Section ${++i}: ${PARAGRAPH}`);
  }
  return parts.join('\n');
}

function localEstimate(req: ChatRequest): number {
  return estimatePromptTokens(req.system, req.messages.map(messageText));
}

/**
 * Fixed prompts whose official input-token counts are stored in the reference at
 * fingerprint time. Three lengths let us separate a constant per-request excess (hidden
 * prompt) from a proportional one (different tokenizer = different model family).
 */
export const BASELINE_NONCE = 'RC-BASELINE-0001';
export const BASELINE_PROMPTS: { id: string; text: string }[] = [
  { id: 'b1', text: billingPrompt(1, BASELINE_NONCE) },
  { id: 'b4', text: billingPrompt(4, BASELINE_NONCE) },
  { id: 'b12', text: billingPrompt(12, BASELINE_NONCE) },
  { id: 'tokenizer', text: TOKENIZER_PROMPT },
];
export const INJECTION_PROMPT_IDS = ['b1', 'b4', 'b12'];

export function baselineRequest(model: string, id: string): ChatRequest {
  const bp = BASELINE_PROMPTS.find((p) => p.id === id);
  if (!bp) throw new Error(`unknown baseline prompt ${id}`);
  return { model, messages: [{ role: 'user', content: bp.text }], maxTokens: 16, temperature: 0 };
}

/** exact thresholds (tokens per request) when an official baseline is available */
export const EXACT_WARN = 4;
export const EXACT_FAIL = 16;

export interface InjectionSample {
  id?: string;
  baseline: number;
  billed: number | null;
  excess: number | null;
}

export interface ExactAnalysis {
  status: 'pass' | 'warn' | 'fail';
  /** median per-request excess over the official count */
  excess: number;
  /** billed-vs-baseline slope between the shortest and longest prompt (1 = same tokenizer) */
  slope: number;
  kind: 'match' | 'constant' | 'proportional' | 'under';
}

/** Classify exact (baseline-calibrated) samples. Pure, unit-tested. */
export function analyzeExact(samples: InjectionSample[]): ExactAnalysis | null {
  const v = samples.filter((s) => s.billed !== null).sort((a, b) => a.baseline - b.baseline);
  if (v.length < 2) return null;
  const ex = v.map((s) => s.billed! - s.baseline).sort((a, b) => a - b);
  const excess = ex[Math.floor(ex.length / 2)];
  const lo = v[0];
  const hi = v[v.length - 1];
  const slope = hi.baseline === lo.baseline ? 1 : (hi.billed! - lo.billed!) / (hi.baseline - lo.baseline);
  const spread = ex[ex.length - 1] - ex[0];
  if (ex.every((e) => Math.abs(e) < EXACT_WARN)) return { status: 'pass', excess, slope, kind: 'match' };
  // a constant excess (same on every prompt length) is a hidden per-request prompt
  if (spread <= Math.max(3, 0.02 * hi.baseline)) {
    if (excess <= -EXACT_WARN) return { status: 'warn', excess, slope, kind: 'under' };
    return { status: excess >= EXACT_FAIL ? 'fail' : 'warn', excess, slope, kind: 'constant' };
  }
  return { status: 'warn', excess, slope, kind: 'proportional' };
}

async function injection(ctx: ProbeContext): Promise<CheckResult> {
  const id = 'billing.hidden_tokens';
  const title = l('隐藏注入 token', 'Hidden injected tokens');
  return guard(id, title, async () => {
    const baseline = usableBaseline(ctx);
    if (baseline) return exactInjection(ctx, id, title, baseline);
    const samples: InjectionSample[] = [];
    let method: 'count_tokens' | 'local_estimate' = 'count_tokens';
    for (const repeats of [2, 6]) {
      const req: ChatRequest = { model: ctx.model, messages: [{ role: 'user', content: billingPrompt(repeats, randomHex(8)) }], maxTokens: 16, temperature: 0 };
      const counted = await ctx.adapter.countTokens(req);
      if (counted === null) method = 'local_estimate';
      const base = counted ?? localEstimate(req);
      const r = await ctx.adapter.chat(req);
      samples.push({ baseline: base, billed: r.usage.input, excess: r.usage.input === null ? null : r.usage.input - base });
    }
    const valid = samples.filter((s) => s.excess !== null);
    if (!valid.length) return result(id, 'warn', title, l('响应没有 usage.input_tokens，无法核对计费', 'response has no usage input tokens; cannot audit billing'), { method, samples, calibrated: false });
    const excess = Math.round(valid.reduce((a, s) => a + s.excess!, 0) / valid.length);
    const base = Math.round(valid.reduce((a, s) => a + s.baseline, 0) / valid.length);
    const constant = valid.length === 2 && Math.abs(valid[0].excess! - valid[1].excess!) <= Math.max(8, 0.1 * Math.abs(excess));
    // count_tokens is exact; the local ~4 chars/token estimate needs a lot of slack
    const exact = method === 'count_tokens';
    const [failAt, warnAt] = exact ? [Math.max(24, 0.05 * base), Math.max(12, 0.03 * base)] : [Math.max(200, 0.5 * base), Math.max(100, 0.25 * base)];
    const evidence = { method, calibrated: exact, samples, excess, constantPerRequest: constant, thresholds: { fail: failAt, warn: warnAt } };
    const how = exact ? l('count_tokens', 'count_tokens') : l('本地估算，未校准', 'local estimate, UNCALIBRATED');
    if (excess > failAt)
      return result(id, 'fail', title, l(`每请求多计约 ${excess} input token（基准：${how.zh}${constant ? '，固定量注入' : ''}）`, `≈${excess} extra input tokens billed per request (baseline: ${how.en}${constant ? ', constant per request' : ''})`), { ...evidence, injectedTokens: excess });
    if (excess > warnAt)
      return result(id, 'warn', title, l(`多计约 ${excess} token，可能有隐藏系统提示（基准：${how.zh}）`, `≈${excess} extra tokens, possibly a hidden system prompt (baseline: ${how.en})`), { ...evidence, injectedTokens: excess });
    return result(
      id,
      'pass',
      title,
      exact
        ? l(`计费与基准相符（差 ${excess}，基准：${how.zh}）`, `billed input matches baseline (diff ${excess}, baseline: ${how.en})`)
        : l(`差 ${excess} token，在估算误差内（基准：${how.zh}；只能发现约 ${Math.round(failAt)} token 以上的注入）`, `diff ${excess} tokens, within estimate error (baseline: ${how.en}; only injections above ~${Math.round(failAt)} tokens are detectable)`),
      { ...evidence, injectedTokens: 0 },
    );
  });
}

/** Reference baseline for this protocol, only when it is for the model under test and its prompts match ours. */
export function usableBaseline(ctx: Pick<ProbeContext, 'ref' | 'model' | 'adapter'>): BillingBaseline | null {
  const b = ctx.ref?.billing?.[ctx.adapter.kind];
  if (!b || ctx.ref!.model !== ctx.model) return null;
  for (const pid of INJECTION_PROMPT_IDS) {
    const bp = BASELINE_PROMPTS.find((p) => p.id === pid)!;
    const q = b.prompts.find((p) => p.id === pid);
    if (!q || q.hash !== promptHash(bp.text)) return null;
  }
  return b;
}

async function exactInjection(ctx: ProbeContext, id: string, title: L10n, baseline: BillingBaseline): Promise<CheckResult> {
  const samples: InjectionSample[] = [];
  for (const pid of INJECTION_PROMPT_IDS) {
    const base = baseline.prompts.find((p) => p.id === pid)!.inputTokens;
    const r = await ctx.adapter.chat(baselineRequest(ctx.model, pid));
    samples.push({ id: pid, baseline: base, billed: r.usage.input, excess: r.usage.input === null ? null : r.usage.input - base });
  }
  const a = analyzeExact(samples);
  const evidence = { method: 'reference_baseline', calibrated: true, baselineMeasuredAt: baseline.measuredAt, samples, analysis: a, thresholds: { warn: EXACT_WARN, fail: EXACT_FAIL } };
  if (!a) return result(id, 'warn', title, l('响应没有 usage.input_tokens，无法核对计费', 'response has no usage input tokens; cannot audit billing'), evidence);
  const how = l(`官方基准 ${ctx.ref!.model}`, `official ${ctx.ref!.model} baseline`);
  switch (a.kind) {
    case 'match':
      return result(id, 'pass', title, l(`计费与官方基准逐 token 一致（差 ${a.excess}，基准：${how.zh}）`, `billed input matches the official count exactly (diff ${a.excess}; baseline: ${how.en})`), { ...evidence, injectedTokens: 0 });
    case 'constant':
      return result(
        id,
        a.status,
        title,
        l(`每请求固定多计 ${a.excess} input token（与官方基准精确比对），疑似隐藏系统提示`, `exactly ${a.excess} extra input tokens on every request vs the official count: a hidden per-request prompt`),
        { ...evidence, injectedTokens: a.excess },
      );
    case 'under':
      return result(id, 'warn', title, l(`计费比官方少 ${-a.excess} token：提示被改写或截断？`, `billed ${-a.excess} tokens fewer than official: prompt rewritten or truncated?`), { ...evidence, injectedTokens: 0 });
    default:
      return result(
        id,
        'warn',
        title,
        l(`计费 token 与官方按比例偏离（×${a.slope.toFixed(2)}，差 ${a.excess}）：分词器不同，可能是别的模型`, `billed tokens scale ×${a.slope.toFixed(2)} vs the official count (median diff ${a.excess}): a different tokenizer, likely a different model`),
        { ...evidence, injectedTokens: null },
      );
  }
}

async function cache(ctx: ProbeContext): Promise<CheckResult> {
  const id = 'billing.prompt_cache';
  const title = l('提示缓存', 'Prompt caching');
  return guard(id, title, async () => {
    const system = cachePrefix(randomHex(10));
    const req: ChatRequest = { model: ctx.model, system, cacheSystem: true, messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 16, temperature: 0 };
    const r1 = await ctx.adapter.chat(req);
    let r2 = await ctx.adapter.chat(req);
    let attempts = 2;
    // OpenAI caching is best effort and routing-dependent: give it one more try after a pause
    if (!(r2.usage.cacheRead ?? 0)) {
      await new Promise((res) => setTimeout(res, ctx.cacheRetryDelayMs ?? 1500));
      r2 = await ctx.adapter.chat(req);
      attempts++;
    }
    const est = localEstimate(req);
    const u1 = r1.usage;
    const u2 = r2.usage;
    const evidence = { promptEstimate: est, first: u1, second: u2, attempts };
    const read = u2.cacheRead ?? 0;
    // the prefix carries a fresh random session id, so nobody can have cached it before our first call
    if ((u1.cacheRead ?? 0) > 0)
      return result(id, 'warn', title, l(`首次请求一个全新的随机前缀就报告缓存命中 ${u1.cacheRead} token（缓存数据不可信）`, `first request of a never-seen random prefix already reports ${u1.cacheRead} cached tokens (cache accounting not trustworthy)`), evidence);
    if (!read) return result(id, 'warn', title, l(`连续 ${attempts} 次相同长前缀，未出现缓存命中（可能被按全价计费）`, `${attempts} identical long-prefix requests, no cache hit reported (may be billed at full price)`), evidence);
    if (read > est * 1.5) return result(id, 'fail', title, l(`缓存读取 ${read} token，超过整个提示（≈${est}）`, `cache read ${read} tokens exceeds the whole prompt (≈${est})`), evidence);
    if (ctx.adapter.kind === 'anthropic') {
      const full1 = (u1.input ?? 0) + (u1.cacheWrite ?? 0) + (u1.cacheRead ?? 0);
      const full2 = (u2.input ?? 0) + read + (u2.cacheWrite ?? 0);
      if ((u2.input ?? 0) > 0.5 * full1)
        return result(id, 'fail', title, l(`命中缓存 ${read} token，但 input_tokens 仍为 ${u2.input}（疑似重复计费）`, `cache hit of ${read} tokens but input_tokens is still ${u2.input} (double billing?)`), evidence);
      if (Math.abs(full2 - full1) > Math.max(16, 0.1 * full1))
        return result(id, 'warn', title, l(`两次请求总 token 不一致（${full1} vs ${full2}）`, `total prompt tokens differ between calls (${full1} vs ${full2})`), evidence);
    } else if (u2.input !== null && read > u2.input) {
      return result(id, 'fail', title, l(`cached_tokens(${read}) 大于 prompt_tokens(${u2.input})`, `cached_tokens (${read}) > prompt_tokens (${u2.input})`), evidence);
    }
    const ratio = +(read / est).toFixed(2);
    return result(id, 'pass', title, l(`第二次命中缓存 ${read} token（约占提示 ${Math.round(ratio * 100)}%）`, `second call read ${read} cached tokens (~${Math.round(ratio * 100)}% of prompt)`), { ...evidence, ratio });
  });
}

export async function runBilling(ctx: ProbeContext): Promise<GroupResult> {
  const results = [await injection(ctx)];
  ctx.log('billing 1/2');
  results.push(await cache(ctx));
  ctx.log('billing 2/2');
  const status = worstStatus(results.map((r) => r.status));
  const inj = (results[0].evidence as any)?.injectedTokens ?? null;
  return {
    id: 'billing',
    status,
    summary:
      results[0].status === 'fail'
        ? l(`每请求多计 ${inj} input token`, `+${inj} hidden input tokens per request`)
        : status === 'fail'
          ? l('缓存计费异常', 'cache billing anomaly')
          : status === 'warn'
            ? l('计费存疑', 'billing uncertain')
            : l('计费正常', 'billing looks honest'),
    results,
    meta: { injectedTokens: results[0].status === 'fail' || results[0].status === 'warn' ? inj : 0 },
  };
}
