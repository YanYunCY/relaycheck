import type { Adapter } from '../api/types.js';
import type { RefFingerprint } from '../fingerprint.js';
import { hash32, mulberry32 } from '../rng.js';
import { type McOptions, alignDistributions, cauchyCombination, formatP, homogeneityTest } from '../stats.js';
import { estimateTokens } from '../tokens.js';
import { type CheckResult, type GroupResult, type L10n, RuntimeError, l, worstStatus } from '../types.js';
import { VERSION } from '../version.js';
import { TOKENIZER_PROMPT, TOKENIZER_TEXT } from './billing.js';
import { classify } from './classify.js';
import { type ProbeContext, errMsg, guard, pool, result } from './common.js';

export { classify, normalizeAnswer } from './classify.js';

import { CURRENT_PROBE_SET, type IdentityProbe, type ProbeSet, probeSet } from './probesets.js';
export type { IdentityProbe } from './probesets.js';

/** probes of the current probe set (see probesets.ts) */
export const IDENTITY_PROBES: IdentityProbe[] = CURRENT_PROBE_SET.probes;

export const SELF_REPORT_PROMPT = 'Which AI model are you, exactly? Reply with only your model name.';
export const CUTOFF_PROMPT = 'What is your knowledge cutoff date? Reply with only the month and year.';
export { TOKENIZER_TEXT } from './billing.js';

export async function sampleProbe(
  adapter: Adapter,
  model: string,
  probe: IdentityProbe,
  n: number,
  concurrency: number,
): Promise<{ dist: Record<string, number>; errors: number; lastError?: string; texts: string[] }> {
  const dist: Record<string, number> = {};
  const texts: string[] = [];
  let errors = 0;
  let lastError: string | undefined;
  await pool(Array.from({ length: n }), concurrency, async () => {
    try {
      const r = await adapter.chat({
        model,
        messages: [{ role: 'user', content: probe.prompt }],
        maxTokens: Math.max(adapter.minMaxTokens, 16),
        temperature: 1,
      });
      const lab = classify(probe.labels, r.text, probe.aliases);
      dist[lab] = (dist[lab] ?? 0) + 1;
      if (lab === 'other' && texts.length < 5) texts.push(r.text.slice(0, 60));
    } catch (e) {
      errors++;
      lastError = errMsg(e);
    }
  });
  return { dist, errors, lastError, texts };
}

/** "claude-sonnet-4-5" → ["claude", "sonnet"] (family words worth looking for in a self-report) */
export function familyTokens(model: string): string[] {
  const generic = new Set(['latest', 'preview', 'instruct', 'chat', 'turbo', 'mini', 'pro', 'max', 'think', 'thinking']);
  return model
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !generic.has(w))
    .slice(0, 2);
}

const KNOWN_FAMILIES = ['claude', 'gpt', 'gemini', 'llama', 'qwen', 'deepseek', 'mistral', 'grok', 'glm', 'kimi', 'doubao', 'ernie'];

async function heuristics(ctx: ProbeContext): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const t0 = l('自报身份', 'Self-reported identity');
  out.push(
    await guard('identity.self_report', t0, async () => {
      const r = await ctx.adapter.chat({ model: ctx.model, messages: [{ role: 'user', content: SELF_REPORT_PROMPT }], maxTokens: 32, temperature: 0 });
      const ans = r.text.trim().slice(0, 120);
      const lower = ans.toLowerCase();
      const fam = familyTokens(ctx.model);
      const match = lower.includes(ctx.model.toLowerCase()) || (fam.length > 0 && lower.includes(fam[0]));
      const claimed = KNOWN_FAMILIES.filter((f) => lower.includes(f));
      const foreign = claimed.filter((f) => !ctx.model.toLowerCase().includes(f));
      if (match && !foreign.length) return result('identity.self_report', 'pass', t0, l(`自称「${ans}」，与请求模型同一家族（自报不可靠，仅供参考）`, `answered "${ans}", same family as the requested model (self-reports are unreliable)`), { answer: ans });
      // naming ANOTHER vendor's family is worth a warning; a vague or outdated self-report is not
      // (genuine models often misname themselves, and that must not make an honest relay "inconclusive")
      if (foreign.length)
        return result(
          'identity.self_report',
          'warn',
          t0,
          l(`自称「${ans}」，属于其他家族（${foreign.join(', ')}），与请求的 ${ctx.model} 不符（自报不可靠，仅作参考）`, `answered "${ans}", another family (${foreign.join(', ')}) than ${ctx.model} (self-reports are unreliable; evidence only)`),
          { answer: ans, foreignFamilies: foreign },
        );
      return result('identity.self_report', 'info', t0, l(`自称「${ans}」（自报不可靠，不参与判定）`, `answered "${ans}" (self-reports are unreliable; not used for the verdict)`), { answer: ans, foreignFamilies: [] });
    }),
  );
  const t1 = l('知识截止', 'Knowledge cutoff');
  out.push(
    await guard('identity.cutoff', t1, async () => {
      const r = await ctx.adapter.chat({ model: ctx.model, messages: [{ role: 'user', content: CUTOFF_PROMPT }], maxTokens: 24, temperature: 0 });
      const ans = r.text.trim().slice(0, 80);
      return result('identity.cutoff', 'info', t1, l(`自称知识截止：${ans}`, `claims knowledge cutoff: ${ans}`), { answer: ans });
    }),
  );
  const t2 = l('分词器长度特征', 'Tokenizer length signature');
  out.push(
    await guard('identity.tokenizer', t2, async () => {
      const r = await ctx.adapter.chat({ model: ctx.model, messages: [{ role: 'user', content: TOKENIZER_PROMPT }], maxTokens: 16, temperature: 0 });
      const chars = TOKENIZER_TEXT.length;
      const input = r.usage.input;
      const ratio = input ? +(chars / input).toFixed(2) : null;
      const refCount = ctx.ref?.billing?.[ctx.adapter.kind]?.prompts.find((p) => p.id === 'tokenizer')?.inputTokens ?? null;
      const ev = { inputTokens: input, referenceInputTokens: refCount, chars, charsPerToken: ratio, localEstimate: estimateTokens(TOKENIZER_TEXT) };
      if (refCount !== null && input !== null) {
        const same = input === refCount;
        return result(
          'identity.tokenizer',
          'info',
          t2,
          same
            ? l(`固定文本计 ${input} input token，与 ${ctx.ref!.model} 官方计数一致`, `fixed text billed as ${input} input tokens, same as the official ${ctx.ref!.model} count`)
            : l(`固定文本计 ${input} token，官方 ${ctx.ref!.model} 为 ${refCount}（分词器不同或有注入，见计费组）`, `fixed text billed as ${input} tokens vs ${refCount} for official ${ctx.ref!.model} (different tokenizer or injected prompt; see billing)`),
          { ...ev, matchesReference: same },
        );
      }
      return result(
        'identity.tokenizer',
        'info',
        t2,
        l(`固定文本计 ${input ?? '?'} input token（${ratio ?? '?'} 字符/token）`, `fixed text billed as ${input ?? '?'} input tokens (${ratio ?? '?'} chars/token)`),
        ev,
      );
    }),
  );
  return out;
}

export interface ProbeStat {
  id: string;
  n: number;
  errors: number;
  pValue: number;
  method: string;
  reps: number;
  chi2: number;
  df: number;
  js: number;
  observed: Record<string, number>;
  reference: Record<string, number>;
}

export const FAIL_P = 0.001;
export const WARN_P = 0.01;
/** a run where more than this share of identity requests failed is never called "consistent" */
export const MAX_ERROR_RATE = 0.2;

export interface ObservedProbe {
  id: string;
  dist: Record<string, number>;
  errors: number;
}

export interface IdentityScore {
  /** Cauchy-combined endpoint p-value over informative probes (null when nothing was observed) */
  pValue: number | null;
  status: 'pass' | 'warn' | 'fail';
  stats: ProbeStat[];
  /** probes with df > 0 (the only ones that enter the combination) */
  informative: number;
  errorRate: number;
  meanJs: number;
  worst: string[];
}

/**
 * Pure scoring step shared by the CLI and the calibration scripts:
 * per-probe two-sample Monte Carlo homogeneity test → Cauchy combination → thresholds.
 * Each probe gets its own RNG stream (seed ⊕ probe id) so p-values do not depend on order.
 */
/** dispersion factors above this are capped (and an endpoint that unstable cannot be fingerprinted well) */
export const MAX_DISPERSION = 2;

/** φ used for the correction: the reference's estimate, floored at 1, capped at MAX_DISPERSION */
export function dispersionOf(ref: Partial<Pick<RefFingerprint, 'dispersion'>>): number {
  const phi = ref.dispersion?.phi;
  return typeof phi === 'number' && Number.isFinite(phi) ? Math.min(MAX_DISPERSION, Math.max(1, phi)) : 1;
}

export function scoreIdentity(observed: ObservedProbe[], ref: Pick<RefFingerprint, 'probes'> & Partial<Pick<RefFingerprint, 'dispersion'>>, seed: number, mc: McOptions = {}, requestedPerProbe?: number): IdentityScore {
  const stats: ProbeStat[] = [];
  mc = { dispersion: dispersionOf(ref), ...mc };
  let errors = 0;
  let requested = 0;
  for (const o of observed) {
    const rp = ref.probes.find((p) => p.id === o.id);
    errors += o.errors;
    const n = Object.values(o.dist).reduce((a, b) => a + b, 0);
    requested += requestedPerProbe ?? n + o.errors;
    if (!rp || n === 0) continue;
    const al = alignDistributions(o.dist, rp.dist);
    const t = homogeneityTest(al.a, al.b, mulberry32(hash32(`${seed}:${o.id}`)), mc);
    stats.push({ id: o.id, n, errors: o.errors, pValue: t.pValue, method: t.method, reps: t.reps, chi2: +t.stat.toFixed(3), df: t.df, js: +t.js.toFixed(4), observed: o.dist, reference: rp.dist });
  }
  const errorRate = requested ? errors / requested : 0;
  if (!stats.length) return { pValue: null, status: 'warn', stats, informative: 0, errorRate, meanJs: 0, worst: [] };
  // probes where both sides gave the same single answer (df=0) carry no evidence either way
  const informative = stats.filter((s) => s.df > 0);
  const pValue = informative.length ? cauchyCombination(informative.map((s) => s.pValue)) : 1;
  const meanJs = stats.reduce((a, s) => a + s.js, 0) / stats.length;
  const worst = [...informative].sort((a, b) => a.pValue - b.pValue).slice(0, 3).map((s) => s.id);
  let status: IdentityScore['status'] = pValue < FAIL_P ? 'fail' : pValue < WARN_P ? 'warn' : 'pass';
  if (status === 'pass' && errorRate > MAX_ERROR_RATE) status = 'warn';
  return { pValue, status, stats, informative: informative.length, errorRate, meanJs, worst };
}

export interface RefCompat {
  set: ProbeSet;
  /** settings that can cause false alarms (→ warn) */
  problems: L10n[];
  /** differences worth knowing that are not known to shift answers (→ info) */
  notes: L10n[];
}

/** Which probe definitions to use for a reference, and what does not match the current run. */
export function refCompatibility(ref: RefFingerprint, opts: { api: string; reasoningEffort?: string }): RefCompat {
  const version = ref.probeSetVersion ?? 1;
  const set = probeSet(version);
  if (!set) throw new RuntimeError(`reference uses identity probe set v${version}, unknown to relaycheck ${VERSION}; upgrade relaycheck or regenerate the reference with \`relaycheck fingerprint\``);
  for (const rp of ref.probes) {
    const def = set.probes.find((p) => p.id === rp.id);
    if (!def || def.prompt !== rp.prompt) throw new RuntimeError(`reference probe "${rp.id}" does not match probe set v${version}; the reference was edited or made by another tool — regenerate it`);
  }
  const problems: L10n[] = [];
  const notes: L10n[] = [];
  if (version !== CURRENT_PROBE_SET.version)
    problems.push(l(`参考指纹使用旧探针集 v${version}（当前 v${CURRENT_PROBE_SET.version}），区分力较弱，建议重新生成`, `reference uses the older probe set v${version} (current v${CURRENT_PROBE_SET.version}), which discriminates less; regenerate it`));
  const s = ref.sampling;
  if (s) {
    if (s.api && s.api !== opts.api)
      notes.push(l(`参考指纹用 ${s.api} 协议采样，本次用 ${opts.api}：不同协议的默认行为可能不同`, `reference was sampled over ${s.api}, this run uses ${opts.api}; protocol defaults may differ`));
    if ((s.reasoningEffort ?? '') !== (opts.reasoningEffort ?? ''))
      problems.push(l(`参考指纹的 reasoning effort 为 ${s.reasoningEffort ?? '默认'}，本次为 ${opts.reasoningEffort ?? '默认'}：采样设置不同会造成误报`, `reference used reasoning effort "${s.reasoningEffort ?? 'default'}", this run "${opts.reasoningEffort ?? 'default'}": mismatched sampling settings cause false alarms`));
  }
  return { set, problems, notes };
}

export async function runIdentity(ctx: ProbeContext): Promise<GroupResult> {
  const results: CheckResult[] = [];
  const title = l('统计指纹', 'Statistical fingerprint');
  let pValue: number | null = null;
  if (!ctx.ref) {
    results.push(
      result(
        'identity.fingerprint',
        'warn',
        title,
        l('没有参考指纹（--ref），已退化为启发式检查：未校准', 'no reference fingerprint (--ref): fell back to heuristics — UNCALIBRATED'),
        { calibrated: false },
      ),
    );
  } else {
    const ref = ctx.ref;
    const compat = refCompatibility(ref, { api: ctx.adapter.kind, reasoningEffort: ctx.reasoningEffort });
    const observed: ObservedProbe[] = [];
    const otherTexts: Record<string, string[]> = {};
    let lastError: string | undefined;
    let done = 0;
    for (const rp of ref.probes) {
      const def = compat.set.probes.find((p) => p.id === rp.id)!;
      const s = await sampleProbe(ctx.adapter, ctx.model, def, ctx.samples, ctx.concurrency);
      lastError = s.lastError ?? lastError;
      observed.push({ id: rp.id, dist: s.dist, errors: s.errors });
      if (s.texts.length) otherTexts[rp.id] = s.texts;
      ctx.log(`identity ${++done}/${ref.probes.length}`);
    }
    const sc = scoreIdentity(observed, ref, ctx.seed, {}, ctx.samples);
    pValue = sc.pValue;
    if (sc.pValue === null) {
      results.push(result('identity.fingerprint', 'warn', title, l(`全部采样失败：${lastError ?? ''}`, `all samples failed: ${lastError ?? ''}`), { errorRate: sc.errorRate }));
    } else {
      const ps = formatP(sc.pValue);
      const status = sc.status;
      const errPct = (sc.errorRate * 100).toFixed(0);
      const detail =
        status === 'fail'
          ? l(`p=${ps}，回答分布与 ${ref.model} 参考指纹显著不同（平均 JS=${sc.meanJs.toFixed(3)}；差异最大：${sc.worst.join(', ')}）`, `p=${ps}: answer distributions differ significantly from the ${ref.model} reference (mean JS=${sc.meanJs.toFixed(3)}; most different: ${sc.worst.join(', ')})`)
          : status === 'warn'
            ? sc.pValue >= WARN_P
              ? l(`p=${ps}，但 ${errPct}% 的采样请求失败，结论不可靠`, `p=${ps}, but ${errPct}% of sample requests failed; not reliable`)
              : l(`p=${ps}，与参考略有偏离（错误率 ${errPct}%），建议加大 --samples 复测`, `p=${ps}: mild deviation from the reference (error rate ${errPct}%); re-run with more --samples`)
            : l(`p=${ps}，与 ${ref.model} 参考指纹一致（${sc.stats.length} 个探针 × ${ctx.samples} 次，平均 JS=${sc.meanJs.toFixed(3)}）`, `p=${ps}: consistent with the ${ref.model} reference (${sc.stats.length} probes × ${ctx.samples} samples, mean JS=${sc.meanJs.toFixed(3)})`);
      results.push(
        result('identity.fingerprint', status, title, detail, {
          calibrated: true,
          pValue: sc.pValue,
          combination: 'cauchy',
          thresholds: { fail: FAIL_P, warn: WARN_P },
          probeSetVersion: compat.set.version,
          dispersion: dispersionOf(ref),
          samplesPerProbe: ctx.samples,
          informativeProbes: sc.informative,
          errorRate: sc.errorRate,
          meanJs: sc.meanJs,
          unclassifiedExamples: otherTexts,
          probes: sc.stats,
        }),
      );
    }
    const all = [...compat.problems, ...compat.notes];
    if (all.length)
      results.push(
        result('identity.ref_compat', compat.problems.length ? 'warn' : 'info', l('参考指纹兼容性', 'Reference compatibility'), {
          zh: all.map((p) => p.zh).join('；'),
          en: all.map((p) => p.en).join('; '),
        }),
      );
  }
  results.push(...(await heuristics(ctx)));
  const status = worstStatus(results.map((r) => r.status));
  const calibrated = !!ctx.ref;
  return {
    id: 'identity',
    status,
    summary:
      status === 'pass'
        ? l('身份一致', 'identity consistent')
        : status === 'fail'
          ? l('疑似换模型', 'likely model swap')
          : calibrated
            ? l('身份存疑', 'identity uncertain')
            : l('未校准（无参考指纹）', 'uncalibrated (no reference)'),
    results,
    meta: { pValue, calibrated },
  };
}
