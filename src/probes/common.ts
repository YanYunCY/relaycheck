import type { Adapter } from '../api/types.js';
import type { RefFingerprint } from '../fingerprint.js';
import { type CheckResult, type L10n, type Status, l } from '../types.js';

export interface ProbeContext {
  adapter: Adapter;
  model: string;
  samples: number;
  concurrency: number;
  ref: RefFingerprint | null;
  deep: boolean;
  /** reasoning effort requested for this run (compared with the reference's sampling settings) */
  reasoningEffort?: string;
  /** seed for the Monte Carlo p-values (deterministic reports) */
  seed: number;
  /** pause before the third prompt-cache request (tests set 0) */
  cacheRetryDelayMs?: number;
  log: (msg: string) => void;
}

/** Run async jobs with bounded concurrency, preserving order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Wrap a single check so a thrown error becomes a `warn` result instead of crashing the run. */
export async function guard(id: string, title: L10n, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn();
  } catch (e) {
    return {
      id,
      status: 'warn',
      title,
      detail: l(`请求出错，无法判定：${errMsg(e)}`, `request failed, cannot judge: ${errMsg(e)}`),
      evidence: { error: errMsg(e) },
    };
  }
}

export function result(id: string, status: Status, title: L10n, detail: L10n, evidence?: unknown): CheckResult {
  return { id, status, title, detail, evidence };
}
