import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Adapter, ApiKind } from './api/types.js';
import { BASELINE_PROMPTS, baselineRequest } from './probes/billing.js';
import { IDENTITY_PROBES, type IdentityProbe, sampleProbe } from './probes/identity.js';
import { CURRENT_PROBE_SET } from './probes/probesets.js';
import { promptHash } from './rng.js';
import { estimateDispersion } from './stats.js';

export { promptHash } from './rng.js';

export interface BillingBaseline {
  /** official usage input tokens for each fixed prompt (see BASELINE_PROMPTS) */
  prompts: { id: string; hash: string; inputTokens: number }[];
  measuredAt: string;
}

export interface SamplingConfig {
  api: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort?: string;
}

export interface RefFingerprint {
  model: string;
  api: ApiKind | string;
  created: string;
  samples: number;
  /** identity probe set the distributions were sampled with (missing = 1, relaycheck 0.1) */
  probeSetVersion?: number;
  /** request settings used for the identity samples */
  sampling?: SamplingConfig;
  probes: { id: string; prompt: string; dist: Record<string, number> }[];
  /**
   * over-dispersion of the endpoint estimated from answer counts across time blocks
   * (φ = Σχ²/Σdf); the identity test divides its statistic by max(1, φ)
   */
  dispersion?: { phi: number; df: number; blocks: number; source: string };
  /** exact per-protocol input-token baselines for the billing check, keyed by API kind */
  billing?: Record<string, BillingBaseline>;
  /** true for fingerprints generated from the mock server — not a real model */
  synthetic?: boolean;
  note?: string;
}

export async function generateFingerprint(
  adapter: Adapter,
  model: string,
  samples: number,
  concurrency: number,
  log: (s: string) => void = () => {},
  probes: IdentityProbe[] = IDENTITY_PROBES,
  reasoningEffort?: string,
): Promise<RefFingerprint> {
  const out: RefFingerprint = {
    model,
    api: adapter.kind,
    created: new Date().toISOString(),
    samples,
    probeSetVersion: CURRENT_PROBE_SET.version,
    sampling: { api: adapter.kind, temperature: 1, maxTokens: Math.max(adapter.minMaxTokens, 16), ...(reasoningEffort ? { reasoningEffort } : {}) },
    probes: [],
  };
  // sample in interleaved time blocks (all probes, then all probes again …) so the reference is
  // spread over time and the between-block variation estimates the endpoint's over-dispersion
  const nBlocks = samples >= 40 ? 4 : 1;
  const per = Array.from({ length: nBlocks }, (_, b) => Math.floor(samples / nBlocks) + (b < samples % nBlocks ? 1 : 0));
  const blocks: Record<string, Record<string, number>[]> = {};
  let i = 0;
  for (let b = 0; b < nBlocks; b++) {
    for (const p of probes) {
      const s = await sampleProbe(adapter, model, p, per[b], concurrency);
      if (s.errors > per[b] / 2) throw new Error(`probe ${p.id}: ${s.errors}/${per[b]} requests failed (${s.lastError})`);
      (blocks[p.id] ??= []).push(s.dist);
      log(`fingerprint ${++i}/${probes.length * nBlocks}`);
    }
  }
  for (const p of probes) {
    const dist: Record<string, number> = {};
    for (const d of blocks[p.id]) for (const [k, v] of Object.entries(d)) dist[k] = (dist[k] ?? 0) + v;
    out.probes.push({ id: p.id, prompt: p.prompt, dist });
  }
  if (nBlocks > 1) {
    const est = estimateDispersion(
      probes.map((p) => {
        const labs = [...new Set(blocks[p.id].flatMap((d) => Object.keys(d)))];
        return blocks[p.id].map((d) => labs.map((l) => d[l] ?? 0));
      }),
    );
    out.dispersion = { phi: +est.phi.toFixed(3), df: est.df, blocks: nBlocks, source: 'fingerprint time blocks' };
  }
  return out;
}

/**
 * Measure the exact input tokens the (trusted) endpoint bills for each fixed baseline prompt.
 * Each prompt is sent twice; differing counts mean the endpoint itself is not deterministic
 * and the baseline is refused.
 */
export async function measureBillingBaseline(adapter: Adapter, model: string): Promise<BillingBaseline> {
  const prompts: BillingBaseline['prompts'] = [];
  for (const bp of BASELINE_PROMPTS) {
    const req = baselineRequest(model, bp.id);
    const counts: number[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await adapter.chat(req);
      if (r.usage.input === null) throw new Error('endpoint reports no usage input tokens');
      counts.push(r.usage.input);
    }
    if (counts[0] !== counts[1]) throw new Error(`baseline prompt ${bp.id} billed ${counts.join(' vs ')} tokens on repeat`);
    prompts.push({ id: bp.id, hash: promptHash(bp.text), inputTokens: counts[0] });
  }
  return { prompts, measuredAt: new Date().toISOString() };
}

export function validateRef(x: any, path = 'reference'): RefFingerprint {
  const bad = (m: string) => new Error(`invalid reference fingerprint ${path}: ${m}`);
  if (!x || typeof x !== 'object') throw bad('not an object');
  if (typeof x.model !== 'string') throw bad('missing "model"');
  if (!Array.isArray(x.probes) || x.probes.length === 0) throw bad('missing "probes"');
  for (const p of x.probes) {
    if (typeof p?.id !== 'string' || typeof p?.prompt !== 'string' || !p.dist || typeof p.dist !== 'object') throw bad(`bad probe entry ${JSON.stringify(p).slice(0, 80)}`);
    for (const v of Object.values(p.dist)) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw bad(`bad count in probe ${p.id}`);
  }
  if (x.dispersion !== undefined && !(typeof x.dispersion?.phi === 'number' && Number.isFinite(x.dispersion.phi) && x.dispersion.phi > 0)) throw bad('bad "dispersion"');
  if (x.probeSetVersion !== undefined && !(Number.isInteger(x.probeSetVersion) && x.probeSetVersion >= 1)) throw bad('bad "probeSetVersion"');
  if (x.billing !== undefined) {
    if (!x.billing || typeof x.billing !== 'object') throw bad('bad "billing"');
    for (const [k, b] of Object.entries<any>(x.billing))
      if (!Array.isArray(b?.prompts) || b.prompts.some((q: any) => typeof q?.id !== 'string' || typeof q?.hash !== 'string' || !Number.isInteger(q?.inputTokens)))
        throw bad(`bad billing baseline for ${k}`);
  }
  return { samples: 0, api: 'unknown', created: '', ...x } as RefFingerprint;
}

export function loadRef(path: string): RefFingerprint {
  return validateRef(JSON.parse(readFileSync(path, 'utf8')), path);
}

export function saveRef(path: string, ref: RefFingerprint): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(ref, null, 2) + '\n');
}

/** Look for refs/<model>.json in cwd, then in the package's bundled refs/ directory. */
export function findRef(model: string, cwd = process.cwd()): string | null {
  const name = `${model.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
  const candidates = [join(cwd, 'refs', name)];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, '..', 'refs', name));
  } catch {
    /* ignore */
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}
