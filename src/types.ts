export type Status = 'pass' | 'warn' | 'fail' | 'skip' | 'info';
export type Lang = 'zh' | 'en';
export interface L10n {
  zh: string;
  en: string;
}
export type GroupId = 'identity' | 'protocol' | 'billing' | 'context';
export const ALL_GROUPS: GroupId[] = ['identity', 'protocol', 'billing', 'context'];

export interface CheckResult {
  id: string;
  status: Status;
  title: L10n;
  detail: L10n;
  evidence?: unknown;
}

export interface GroupResult {
  id: GroupId;
  status: Status;
  summary: L10n;
  results: CheckResult[];
  meta?: Record<string, unknown>;
}

export type Verdict = 'consistent' | 'inconsistent' | 'inconclusive';

export interface Report {
  tool: 'relaycheck';
  version: string;
  target: { baseUrl: string; host: string; model: string; api: string };
  startedAt: string;
  durationMs: number;
  verdict: Verdict;
  exitCode: 0 | 1 | 2;
  headline: L10n;
  pValue: number | null;
  calibrated: boolean;
  injectedTokens: number | null;
  reference: { path: string; model: string; samples: number; synthetic: boolean; probeSetVersion: number } | null;
  /** what this check itself consumed, as reported by the endpoint's usage fields */
  usage: { requests: number; inputTokens: number; outputTokens: number };
  groups: GroupResult[];
}

const RANK: Record<Status, number> = { fail: 4, warn: 3, pass: 2, info: 1, skip: 0 };

/** Worst status among results; `info` never escalates past `pass`. */
export function worstStatus(statuses: Status[]): Status {
  let best: Status = 'skip';
  for (const s of statuses) if (RANK[s] > RANK[best]) best = s;
  if (best === 'info') return 'pass';
  return best;
}

export function l(zh: string, en: string): L10n {
  return { zh, en };
}

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}
