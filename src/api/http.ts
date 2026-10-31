export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    url: string,
  ) {
    super(`HTTP ${status} from ${safePath(url)}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export interface HttpOpts {
  timeoutMs: number;
  retries: number;
  /** base backoff in ms (tests set this low) */
  backoffMs?: number;
  /** cap for any single wait, including Retry-After */
  maxWaitMs?: number;
}

/** 408 timeout, 409 conflict (OpenAI uses it transiently), 425, 429 rate limit, 5xx incl. Anthropic 529 overloaded */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

/** Parse Retry-After (delta-seconds or HTTP date) and OpenAI-style retry-after-ms; ms or null. */
export function retryAfterMs(h: Headers, now = Date.now()): number | null {
  const ms = h.get('retry-after-ms');
  if (ms && /^\d+(\.\d+)?$/.test(ms.trim())) return Math.round(Number(ms));
  const ra = h.get('retry-after');
  if (!ra) return null;
  if (/^\d+(\.\d+)?$/.test(ra.trim())) return Math.round(Number(ra) * 1000);
  const t = Date.parse(ra);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

/** exponential backoff with full jitter: uniform in [base·2^n / 2, base·2^n] */
export function backoffDelay(attempt: number, baseMs: number, rng: () => number = Math.random): number {
  const d = baseMs * 2 ** attempt;
  return Math.round(d / 2 + rng() * (d / 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(url: string, headers: Record<string, string>, body: unknown, opts: HttpOpts): Promise<Response> {
  let lastErr: unknown;
  const base = opts.backoffMs ?? 800;
  const cap = opts.maxWaitMs ?? 60_000;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (e) {
      // network error or timeout: retry with backoff
      lastErr = e;
      if (attempt < opts.retries) {
        await sleep(Math.min(cap, backoffDelay(attempt, base)));
        continue;
      }
      break;
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    const err = new HttpError(res.status, text, url);
    if (isRetryableStatus(res.status) && attempt < opts.retries) {
      lastErr = err;
      const hinted = retryAfterMs(res.headers);
      await sleep(Math.min(cap, Math.max(hinted ?? 0, backoffDelay(attempt, base))));
      continue;
    }
    throw err;
  }
  if (lastErr instanceof HttpError) throw lastErr;
  const msg = lastErr instanceof Error ? `${lastErr.message}${(lastErr as any).cause ? ` (${(lastErr as any).cause.code ?? (lastErr as any).cause.message ?? ''})` : ''}` : String(lastErr);
  throw new Error(`request to ${safePath(url)} failed after ${opts.retries + 1} attempts: ${msg}`);
}

export async function postJson(url: string, headers: Record<string, string>, body: unknown, opts: HttpOpts): Promise<any> {
  const res = await request(url, headers, body, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response from ${safePath(url)}: ${text.slice(0, 200)}`);
  }
}

export interface SseEvent {
  event: string | null;
  data: string;
}

/**
 * WHATWG-style SSE parser: \n, \r\n and lone \r line endings, optional BOM, comments,
 * "field" lines without a colon, single optional space after the colon, multi-line data.
 * An event is dispatched at a blank line; a final event without a trailing blank line is
 * still returned (truncated streams are judged by the protocol checks, not dropped here).
 */
export function parseSse(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  let event: string | null = null;
  let data: string[] = [];
  let hasData = false;
  const dispatch = () => {
    if (hasData || event !== null) out.push({ event, data: data.join('\n') });
    event = null;
    data = [];
    hasData = false;
  };
  for (const line of lines) {
    if (line === '') {
      dispatch();
      continue;
    }
    if (line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value.trim();
    else if (field === 'data') {
      data.push(value);
      hasData = true;
    }
  }
  dispatch();
  return out;
}

export async function postSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: HttpOpts,
): Promise<{ events: SseEvent[]; contentType: string }> {
  const res = await request(url, { accept: 'text/event-stream', ...headers }, body, opts);
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  return { events: parseSse(text), contentType };
}

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

/** Accept https://host, https://host/ or https://host/v1 — always return .../v1 */
export function normalizeBaseUrl(url: string): string {
  const u = new URL(url);
  let p = u.pathname.replace(/\/+$/, '');
  if (!/\/v1$/.test(p)) p += '/v1';
  u.pathname = p;
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/+$/, '');
}

export function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
