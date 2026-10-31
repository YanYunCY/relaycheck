/**
 * Secrets never leave this module unredacted. Every string we print, log or
 * write to a report file passes through a Redactor first.
 */
export const REDACTED = '[REDACTED]';

export class Redactor {
  private secrets: string[] = [];

  add(secret: string | undefined | null): void {
    if (!secret || secret.length < 4) return;
    if (!this.secrets.includes(secret)) this.secrets.push(secret);
    // longest first so overlapping secrets are fully masked
    this.secrets.sort((a, b) => b.length - a.length);
  }

  redact(s: string): string {
    let out = s;
    for (const sec of this.secrets) out = out.split(sec).join(REDACTED);
    // Generic patterns that look like API keys, even if not registered.
    // keep only a short, non-identifying prefix of unregistered key-like strings
    out = out.replace(/\b((?:sk|rk|pk)-(?:ant-|proj-|svcacct-|or-v1-)?)[A-Za-z0-9_-]{12,}/g, `$1${REDACTED}`);
    out = out.replace(/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED);
    out = out.replace(/\b(gh[pousr]_)[A-Za-z0-9]{20,}/g, `$1${REDACTED}`);
    out = out.replace(/((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`);
    out = out.replace(/((?:x-api-key|api-key|x-goog-api-key)["']?\s*[:=]\s*["']?)[^\s"',}]{8,}/gi, `$1${REDACTED}`);
    out = out.replace(/([?&](?:key|api_key|apikey|api-key|token|access_token|auth)=)[^&\s"']+/gi, `$1${REDACTED}`);
    out = out.replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, `$1${REDACTED}@`);
    return out;
  }

  redactDeep<T>(value: T): T {
    if (typeof value === 'string') return this.redact(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.redactDeep(v)) as unknown as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (/^(authorization|proxy-authorization|x-api-key|x-goog-api-key|api[-_]?key|cookie|set-cookie)$/i.test(k)) out[k] = REDACTED;
        else out[k] = this.redactDeep(v);
      }
      return out as T;
    }
    return value;
  }
}

/** Strip credentials/query from a URL so it is safe to show locally. */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '[invalid-url]';
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Hide host name for sharable artifacts: https://•••/v1 */
export function maskHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//•••${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return '•••';
  }
}
