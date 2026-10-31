import { createAdapter, detectApi } from './api/detect.js';
import { HttpError, normalizeBaseUrl } from './api/http.js';
import type { Adapter, ApiKind } from './api/types.js';
import type { RefFingerprint } from './fingerprint.js';
import { runBilling } from './probes/billing.js';
import type { ProbeContext } from './probes/common.js';
import { runContext } from './probes/context.js';
import { runIdentity } from './probes/identity.js';
import { runProtocol } from './probes/protocol.js';
import { hostOf, sanitizeUrl } from './redact.js';
import { formatP } from './stats.js';
import { type GroupId, type GroupResult, type L10n, type Report, RuntimeError, type Verdict, l } from './types.js';
import { VERSION } from './version.js';

export interface CheckOptions {
  baseUrl: string;
  model: string;
  api: ApiKind | 'auto';
  key: string;
  samples: number;
  probes: GroupId[];
  ref: RefFingerprint | null;
  refPath: string | null;
  deep: boolean;
  concurrency: number;
  timeoutMs: number;
  retries?: number;
  reasoningEffort?: string;
  seed: number;
  log: (msg: string) => void;
}

export async function connect(opts: Pick<CheckOptions, 'baseUrl' | 'api' | 'key' | 'timeoutMs' | 'model' | 'log' | 'reasoningEffort' | 'retries'>): Promise<{ adapter: Adapter; baseUrl: string }> {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(opts.baseUrl);
  } catch {
    throw new RuntimeError(`invalid base_url: ${opts.baseUrl}`);
  }
  const ao = { baseUrl, key: opts.key, timeoutMs: opts.timeoutMs, retries: opts.retries ?? 3, reasoningEffort: opts.reasoningEffort };
  let kind: ApiKind;
  if (opts.api === 'auto') {
    try {
      kind = (await detectApi(ao, opts.model)).kind;
    } catch (e) {
      throw new RuntimeError((e as Error).message);
    }
    opts.log(`detected API: ${kind}`);
  } else kind = opts.api;
  const adapter = createAdapter(kind, ao);
  // preflight: a broken key / route / model is a runtime error (exit 3), not a verdict
  try {
    await adapter.chat({ model: opts.model, messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: Math.max(16, adapter.minMaxTokens) });
  } catch (e) {
    const m = e instanceof HttpError ? `HTTP ${e.status}: ${e.body.slice(0, 200)}` : (e as Error).message;
    throw new RuntimeError(`preflight request failed (${kind} @ ${sanitizeUrl(baseUrl)}): ${m}`);
  }
  return { adapter, baseUrl };
}

export interface UsageMeter {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/** Count requests and reported tokens of every call made through the adapter. */
export function meter(adapter: Adapter, usage: UsageMeter = { requests: 0, inputTokens: 0, outputTokens: 0 }): { adapter: Adapter; usage: UsageMeter } {
  const add = (u: { input: number | null; output: number | null }) => {
    usage.requests++;
    usage.inputTokens += u.input ?? 0;
    usage.outputTokens += u.output ?? 0;
  };
  const wrapped: Adapter = Object.create(adapter);
  wrapped.chat = async (req) => {
    const r = await adapter.chat(req);
    add(r.usage);
    return r;
  };
  wrapped.stream = async (req) => {
    const r = await adapter.stream(req);
    add(r.usage);
    return r;
  };
  return { adapter: wrapped, usage };
}

export async function runCheck(opts: CheckOptions): Promise<Report> {
  const started = Date.now();
  const conn = await connect(opts);
  const { adapter, usage } = meter(conn.adapter);
  const baseUrl = conn.baseUrl;
  const ctx: ProbeContext = {
    adapter,
    model: opts.model,
    samples: opts.samples,
    concurrency: opts.concurrency,
    ref: opts.ref,
    deep: opts.deep,
    reasoningEffort: opts.reasoningEffort,
    seed: opts.seed,
    log: opts.log,
  };
  const groups: GroupResult[] = [];
  const runners: Record<GroupId, (c: ProbeContext) => Promise<GroupResult>> = {
    identity: runIdentity,
    protocol: runProtocol,
    billing: runBilling,
    context: runContext,
  };
  for (const g of opts.probes) groups.push(await runners[g](ctx));
  return buildReport({ groups, opts, baseUrl, api: adapter.kind, started, usage });
}

export function buildReport(a: { groups: GroupResult[]; opts: CheckOptions; baseUrl: string; api: string; started: number; usage?: UsageMeter }): Report {
  const { groups, opts } = a;
  const anyFail = groups.some((g) => g.status === 'fail');
  const anyWarn = groups.some((g) => g.status === 'warn');
  const verdict: Verdict = anyFail ? 'inconsistent' : anyWarn ? 'inconclusive' : 'consistent';
  const identity = groups.find((g) => g.id === 'identity');
  const pValue = (identity?.meta?.pValue as number | null | undefined) ?? null;
  const calibrated = !!identity?.meta?.calibrated;
  const billing = groups.find((g) => g.id === 'billing');
  const injected = (billing?.meta?.injectedTokens as number | null | undefined) ?? null;
  return {
    tool: 'relaycheck',
    version: VERSION,
    target: { baseUrl: sanitizeUrl(a.baseUrl), host: hostOf(a.baseUrl), model: opts.model, api: a.api },
    startedAt: new Date(a.started).toISOString(),
    durationMs: Date.now() - a.started,
    verdict,
    exitCode: verdict === 'consistent' ? 0 : verdict === 'inconsistent' ? 1 : 2,
    headline: headline(verdict, groups, opts.model, pValue, injected),
    pValue,
    calibrated,
    injectedTokens: injected,
    reference: opts.ref
      ? { path: opts.refPath ?? '', model: opts.ref.model, samples: opts.ref.samples, synthetic: !!opts.ref.synthetic, probeSetVersion: opts.ref.probeSetVersion ?? 1 }
      : null,
    usage: a.usage ?? { requests: 0, inputTokens: 0, outputTokens: 0 },
    groups,
  };
}

const GROUP_NAMES: Record<GroupId, L10n> = {
  identity: l('身份', 'identity'),
  protocol: l('协议', 'protocol'),
  billing: l('计费', 'billing'),
  context: l('上下文', 'context'),
};

export function groupName(id: GroupId): L10n {
  return GROUP_NAMES[id];
}

function headline(v: Verdict, groups: GroupResult[], model: string, p: number | null, injected: number | null): L10n {
  const get = (id: GroupId) => groups.find((g) => g.id === id);
  if (v === 'consistent') {
    const ran = groups.filter((g) => g.status !== 'skip').map((g) => g.id);
    const others = ran.filter((id) => id !== 'identity');
    const zh: string[] = [];
    const en: string[] = [];
    if (ran.includes('identity')) {
      zh.push(`行为与 ${model} 参考指纹一致${p !== null ? `（p=${formatP(p)}）` : ''}`);
      en.push(`behaves like ${model}${p !== null ? ` (p=${formatP(p)})` : ''}`);
    }
    if (others.length) {
      zh.push(`${others.map((id) => GROUP_NAMES[id].zh).join('/')}未见异常`);
      en.push(`no ${others.map((id) => GROUP_NAMES[id].en).join(', ')} anomalies`);
    }
    if (!zh.length) return l('一致：没有运行任何检查', 'CONSISTENT: no checks ran');
    return l(`一致：${zh.join('，')}`, `CONSISTENT: ${en.join('; ')}`);
  }
  if (v === 'inconsistent') {
    const zh: string[] = [];
    const en: string[] = [];
    if (get('identity')?.status === 'fail') {
      zh.push(`p=${formatP(p)}，行为不像 ${model}`);
      en.push(`p=${formatP(p)}, does not behave like ${model}`);
    }
    if (get('billing')?.status === 'fail') {
      if (injected) {
        zh.push(`每请求多计 ${injected} input token`);
        en.push(`+${injected} hidden input tokens per request`);
      } else {
        zh.push(get('billing')!.summary.zh);
        en.push(get('billing')!.summary.en);
      }
    }
    const ctx = get('context');
    if (ctx?.status === 'fail') {
      const tb = ctx.meta?.truncatedBetween as number[] | null;
      zh.push(tb ? `上下文在 ~${tb[0] / 1000}k–${tb[1] / 1000}k 之间被截断` : '上下文被截断');
      en.push(tb ? `context truncated between ~${tb[0] / 1000}k and ${tb[1] / 1000}k tokens` : 'context truncated');
    }
    const proto = get('protocol');
    if (proto?.status === 'fail') {
      zh.push(proto.summary.zh);
      en.push(proto.summary.en);
    }
    return l(`不一致：${zh.join('；')}`, `INCONSISTENT: ${en.join('; ')}`);
  }
  const warned = groups.filter((g) => g.status === 'warn');
  return l(
    `存疑：${warned.map((g) => `${GROUP_NAMES[g.id].zh}（${g.summary.zh}）`).join('；')}`,
    `INCONCLUSIVE: ${warned.map((g) => `${GROUP_NAMES[g.id].en} (${g.summary.en})`).join('; ')}`,
  );
}
