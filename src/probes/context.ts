import { HttpError } from '../api/http.js';
import { mulberry32, randomHex } from '../rng.js';
import { estimateTokens } from '../tokens.js';
import { type CheckResult, type GroupResult, l, worstStatus } from '../types.js';
import { type ProbeContext, errMsg, result } from './common.js';

const TOWNS = ['Arden', 'Belmore', 'Calloway', 'Dunmere', 'Eastwick', 'Fairhaven', 'Glenrock', 'Holloway', 'Ivybridge', 'Juniper'];
const THINGS = ['river', 'bridge', 'market', 'library', 'harbor', 'orchard', 'mill', 'school', 'tower', 'garden'];
const QUESTION = 'The document above contains three secret passphrases (number 1, 2 and 3). Reply with only the three passphrases, in order, separated by spaces.';

/** Deterministic filler of roughly `tokens` tokens with needles at the given depths (0..1). */
export function buildHaystack(tokens: number, passphrase: string | string[], depth: number | number[] = 0.5, seed = 7): string {
  const rng = mulberry32(seed);
  const sentences: string[] = [];
  let est = 0;
  while (est < tokens) {
    const s = `In the town of ${TOWNS[Math.floor(rng() * 10)]}, the ${THINGS[Math.floor(rng() * 10)]} was rebuilt in ${1700 + Math.floor(rng() * 300)} and is ${Math.floor(rng() * 900) + 10} meters from the square.`;
    sentences.push(s);
    est += estimateTokens(s) + 0.25;
  }
  const passes = Array.isArray(passphrase) ? passphrase : [passphrase];
  const depths = Array.isArray(depth) ? depth : [depth];
  // insert deepest first so earlier indices stay valid
  const order = depths.map((d, i) => ({ d, i })).sort((x, y) => y.d - x.d);
  for (const { d, i } of order) {
    const label = passes.length > 1 ? ` number ${i + 1}` : '';
    sentences.splice(Math.floor(sentences.length * d), 0, `The secret passphrase${label} is ${passes[i]}.`);
  }
  return sentences.join(' ');
}

/** Needles sit near the start, middle and end, so head-only, tail-only and middle-out truncation are all caught. */
export const NEEDLE_DEPTHS = [0.1, 0.5, 0.9];

/** Answer contains the passphrase, tolerating case, markdown, Unicode dashes and spaces ("rc – 1a2b3c"). */
export function containsPassphrase(answer: string, pass: string): boolean {
  const canon = (s: string) => s.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return canon(answer).includes(canon(pass));
}

export interface NeedleOutcome {
  targetTokens: number;
  /** true = all needles recalled, false = a needle was missed in a complete answer, null = inconclusive */
  found: boolean | null;
  recalled?: boolean[];
  answer?: string;
  stop?: string | null;
  billedInput?: number | null;
  error?: string;
  rejected?: boolean;
  note?: string;
}

async function needle(ctx: ProbeContext, targetTokens: number): Promise<NeedleOutcome> {
  const passes = NEEDLE_DEPTHS.map(() => `RC-${randomHex(6)}`);
  const doc = buildHaystack(targetTokens, passes, NEEDLE_DEPTHS, targetTokens);
  try {
    const r = await ctx.adapter.chat({ model: ctx.model, messages: [{ role: 'user', content: `<document>\n${doc}\n</document>\n\n${QUESTION}` }], maxTokens: 96, temperature: 0 });
    const recalled = passes.map((p) => containsPassphrase(r.text, p));
    const base = { targetTokens, recalled, answer: r.text.trim().slice(0, 120), stop: r.rawStopReason, billedInput: r.usage.input };
    if (recalled.every(Boolean)) return { ...base, found: true };
    // an answer cut off by max_tokens (e.g. reasoning tokens used the budget) or empty is not evidence of truncation
    if (r.stopReason === 'max_tokens' || !r.text.trim()) return { ...base, found: null, note: 'answer incomplete (max_tokens / empty)' };
    return { ...base, found: false };
  } catch (e) {
    return { targetTokens, found: null, error: errMsg(e), rejected: e instanceof HttpError && (e.status === 400 || e.status === 413) };
  }
}

const k = (n: number) => `${Math.round(n / 1000)}k`;

export async function runContext(ctx: ProbeContext): Promise<GroupResult> {
  const sizes = [2000, 32000, ...(ctx.deep ? [100000] : [])];
  const outcomes: NeedleOutcome[] = [];
  for (const s of sizes) {
    let o = await needle(ctx, s);
    if (o.found === false && s !== sizes[0]) {
      // truncation is deterministic, a recall slip is not: confirm a miss with fresh passphrases
      const again = await needle(ctx, s);
      const missedBoth = (o.recalled ?? []).map((ok, i) => !ok && again.recalled?.[i] === false);
      if (again.found === true) o = { ...again, note: `missed on first try (${o.answer}), recalled on retry: recall slip, not truncation` };
      else if (again.found === false && missedBoth.some(Boolean)) o = { ...again, recalled: missedBoth.map((m) => !m), note: 'missed at the same depth twice' };
      else o = { ...again, found: null, note: 'misses at different depths on retry: model recall problem, inconclusive' };
    }
    outcomes.push(o);
    ctx.log(`context ${outcomes.length}/${sizes.length}`);
  }
  const [control, ...rest] = outcomes;
  const title = l('大海捞针（上下文窗口）', 'Needle in a haystack (context window)');
  const evidence = { outcomes, approxInputTokens: sizes.reduce((a, b) => a + b, 0) };
  let r: CheckResult;
  if (control.found !== true) {
    r = result('context.needle', 'warn', title, l(`连 ${k(control.targetTokens)} 对照组都没找回（${control.error ?? control.answer}），无法判定`, `even the ${k(control.targetTokens)} control failed (${control.error ?? control.answer}); inconclusive`), evidence);
  } else {
    const lost = rest.find((o) => o.found === false);
    const errored = rest.find((o) => o.found === null);
    const okSizes = [control, ...rest].filter((o) => o.found).map((o) => k(o.targetTokens));
    if (lost) {
      const where = (lost.recalled ?? []).map((ok, i) => (ok ? null : `${Math.round(NEEDLE_DEPTHS[i] * 100)}%`)).filter(Boolean).join('/');
      const lastOk = [control, ...rest].filter((o) => o.found && o.targetTokens < lost.targetTokens).pop()!;
      r = result(
        'context.needle',
        'fail',
        title,
        l(`${k(lost.targetTokens)} 文档中位于 ${where} 处的 needle 找不回（答复「${lost.answer}」），上下文在 ~${k(lastOk.targetTokens)}–${k(lost.targetTokens)} 之间被截断`, `in the ${k(lost.targetTokens)} document the needle at ${where} depth was not recalled (answered "${lost.answer}"): context truncated somewhere between ~${k(lastOk.targetTokens)} and ${k(lost.targetTokens)}`),
        { ...evidence, truncatedBetween: [lastOk.targetTokens, lost.targetTokens], missedDepths: where },
      );
    } else if (errored) {
      const why = errored.error ?? errored.note ?? '';
      r = result('context.needle', 'warn', title, l(`${k(errored.targetTokens)} 请求无法判定：${why}`, `${k(errored.targetTokens)} request inconclusive: ${why}`), evidence);
    } else {
      r = result('context.needle', 'pass', title, l(`在 ${okSizes.join(' / ')} 均找回 needle${ctx.deep ? '' : '（--deep 可测 100k）'}`, `needle recalled at ${okSizes.join(' / ')}${ctx.deep ? '' : ' (use --deep for 100k)'}`), evidence);
    }
  }
  const status = worstStatus([r.status]);
  return {
    id: 'context',
    status,
    summary: status === 'fail' ? l('上下文被截断', 'context truncated') : status === 'warn' ? l('上下文存疑', 'context uncertain') : l('上下文完整', 'context intact'),
    results: [r],
    meta: { truncatedBetween: (r.evidence as any)?.truncatedBetween ?? null },
  };
}
