import { hostOf } from '../redact.js';
import { groupName } from '../run.js';
import { formatP } from '../stats.js';
import type { GroupId, GroupResult, Lang, Report, Status, Verdict } from '../types.js';
import { esc } from './html.js';

/** Shared pieces of the share card: measurement, the content model, and small SVG helpers. */
export const CARD_W = 1200;
export const CARD_H = 630;
export const REPO = 'github.com/YanYunCY/relaycheck';

export const CJK_FONTS = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei'";
/** Font stack: Latin UI fonts first, then CJK fonts for every platform, so Chinese never falls back to tofu. */
export const CARD_FONT_STACK = `Inter, system-ui, -apple-system, 'Segoe UI', ${CJK_FONTS}, Roboto, 'Helvetica Neue', Arial, sans-serif`;
export const DISPLAY_STACK = `'Inter Display', ${CARD_FONT_STACK}`;
export const CARD_MONO_STACK = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', ${CJK_FONTS}, monospace`;

export const VERDICT: Record<Verdict, { zh: string; en: string }> = {
  consistent: { zh: '一致', en: 'CONSISTENT' },
  inconsistent: { zh: '不一致', en: 'INCONSISTENT' },
  inconclusive: { zh: '存疑', en: 'INCONCLUSIVE' },
};
export const STATUS_WORD: Record<Status, { zh: string; en: string }> = {
  pass: { zh: '通过', en: 'Pass' },
  fail: { zh: '失败', en: 'Fail' },
  warn: { zh: '存疑', en: 'Warn' },
  skip: { zh: '跳过', en: 'Skip' },
  info: { zh: '信息', en: 'Info' },
};
export const GROUPS: GroupId[] = ['identity', 'protocol', 'billing', 'context'];

// ---------------------------------------------------------------- text measurement

/** True for characters rendered full-width (CJK, kana, hangul, full-width forms and punctuation). */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Conservative width estimate (in em) of one character in a proportional sans (or monospace) font. */
function charEm(ch: string, mono = false): number {
  const cp = ch.codePointAt(0)!;
  if (isWide(cp)) return 1;
  if (mono) return 0.6;
  if (ch === ' ') return 0.3;
  if (/[iljI.,:;'|!·]/.test(ch)) return 0.3;
  if (/[MW@%]/.test(ch)) return 0.9;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.58;
  return 0.56;
}

/** Estimated rendered width in px; errs on the wide side so text never overruns its box. */
export function textWidth(s: string, fontSize: number, bold = false, mono = false, letterSpacing = 0): number {
  let em = 0;
  let n = 0;
  for (const ch of s) {
    em += charEm(ch, mono);
    n++;
  }
  return em * fontSize * (bold && !mono ? 1.06 : 1) + letterSpacing * n;
}

/** Clip to an estimated pixel width, adding an ellipsis when cut. */
export function fitText(s: string, maxPx: number, fontSize: number, bold = false, mono = false): string {
  if (textWidth(s, fontSize, bold, mono) <= maxPx) return s;
  const limit = maxPx - textWidth('…', fontSize, bold, mono);
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charEm(ch, mono) * fontSize * (bold && !mono ? 1.06 : 1);
    if (w + cw > limit) break;
    out += ch;
    w += cw;
  }
  return out.trimEnd() + '…';
}

/** Largest font size (≤ max) at which s fits in maxPx. */
export function fitSize(s: string, maxPx: number, max: number, bold = true, mono = false, min = 12): number {
  const w1 = textWidth(s, 1, bold, mono);
  return Math.max(min, Math.min(max, Math.floor(maxPx / w1)));
}

export function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = /\d{4}-\d{2}-\d{2}/.exec(iso);
    return m ? m[0] : '';
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- content model (shared by both styles)

export interface CardModel {
  lang: Lang;
  other: Lang;
  verdict: Verdict;
  primary: string; // verdict word, primary language
  secondary: string; // verdict word, other language
  model: string;
  modelLabel: string;
  /** decisive number */
  prefix: string;
  big: string;
  unit: string;
  bigLabel: string;
  reason: string;
  chips: { name: string; status: Status; word: string }[];
  date: string;
  host: string;
  /** which number decided: identity p-value, hidden tokens, or groups passed */
  kind: 'p' | 'tokens' | 'groups';
  p: number | null;
  calibrated: boolean;
  version: string;
  /** short deterministic slip number derived from the run (not secret, not unique) */
  serial: string;
}

export const T = {
  model: { zh: '声称模型', en: 'Claimed model' },
  pLabel: { zh: '身份检验 p 值', en: 'Identity p-value' },
  uncal: { zh: '（未校准）', en: ' (uncalibrated)' },
  synthetic: { zh: ' · 合成参考', en: ' · synthetic ref' },
  injLabel: { zh: '每个请求多计的隐藏输入 token', en: 'Hidden input tokens billed per request' },
  injUnit: { zh: 'tokens/请求', en: 'tokens/req' },
  passLabel: { zh: '检查组通过', en: 'Check groups passed' },
  hostHidden: { zh: '主机已隐藏', en: 'host hidden' },
};

export function cardModel(r: Report, lang: Lang, showHost: boolean): CardModel {
  const other: Lang = lang === 'zh' ? 'en' : 'zh';
  const v = VERDICT[r.verdict];
  const get = (id: GroupId): GroupResult | undefined => r.groups.find((g) => g.id === id);
  const st = (id: GroupId): Status => get(id)?.status ?? 'skip';
  const chips = GROUPS.map((id) => {
    const status = st(id);
    const n = groupName(id)[lang];
    return { name: lang === 'en' ? n[0].toUpperCase() + n.slice(1) : n, status, word: STATUS_WORD[status][lang] };
  });
  const ran = chips.filter((c) => c.status !== 'skip');
  const passed = ran.filter((c) => c.status === 'pass' || c.status === 'info').length;

  let big: string;
  let prefix = '';
  let unit = '';
  let bigLabel: string;
  let kind: CardModel['kind'] = 'groups';
  const idDecides = st('identity') === 'fail' || st('identity') === 'warn' || r.verdict === 'consistent';
  if (r.injectedTokens && r.injectedTokens > 0) {
    big = `+${r.injectedTokens}`;
    unit = T.injUnit[lang];
    bigLabel = T.injLabel[lang];
    kind = 'tokens';
  } else if (r.pValue !== null && r.pValue !== undefined && idDecides) {
    prefix = 'p =';
    big = formatP(r.pValue);
    bigLabel = T.pLabel[lang] + (r.calibrated ? '' : T.uncal[lang]) + (r.reference?.synthetic ? T.synthetic[lang] : '');
    kind = 'p';
  } else {
    big = `${passed}/${ran.length || 4}`;
    bigLabel = T.passLabel[lang];
  }
  // one short reason: the worst group's summary (or the headline when everything passed)
  const rank: Record<Status, number> = { fail: 4, warn: 3, pass: 1, info: 1, skip: 0 };
  const worst = [...r.groups].sort((a, b) => rank[b.status] - rank[a.status])[0];
  const allPass = lang === 'zh' ? `${passed}/${ran.length} 项检查通过` : `${passed}/${ran.length} check groups passed`;
  const reason = unit ? '' : worst && rank[worst.status] >= 3 ? worst.summary[lang] : big.includes('/') ? '' : allPass;

  return {
    lang,
    other,
    verdict: r.verdict,
    primary: v[lang],
    secondary: v[other],
    model: r.target.model,
    prefix,
    modelLabel: T.model[lang],
    big,
    unit,
    bigLabel,
    reason,
    chips,
    date: localDate(r.startedAt),
    host: showHost ? hostOf(r.target.baseUrl) || T.hostHidden[lang] : T.hostHidden[lang],
    kind,
    p: r.pValue ?? null,
    calibrated: r.calibrated,
    version: r.version,
    serial: serialOf(`${r.startedAt}|${r.target.model}|${r.verdict}|${r.pValue}`),
  };
}

// ---------------------------------------------------------------- svg helpers

export interface TextOpts {
  size: number;
  fill: string;
  weight?: number;
  anchor?: 'start' | 'middle' | 'end';
  family?: string;
  spacing?: number;
  opacity?: number;
}
export function text(x: number, y: number, s: string, o: TextOpts): string {
  const a = [`x="${x}"`, `y="${y}"`, `font-size="${o.size}"`, `fill="${o.fill}"`];
  if (o.weight) a.push(`font-weight="${o.weight}"`);
  if (o.anchor && o.anchor !== 'start') a.push(`text-anchor="${o.anchor}"`);
  if (o.family) a.push(`font-family="${o.family}"`);
  if (o.spacing) a.push(`letter-spacing="${o.spacing}"`);
  if (o.opacity !== undefined) a.push(`fill-opacity="${o.opacity}"`);
  return `<text ${a.join(' ')}>${esc(s)}</text>`;
}

/** The relaycheck mark: a small square seal carrying 验. */
export function seal(x: number, y: number, size: number, fill: string, ink: string): string {
  return `<g transform="translate(${x} ${y})"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="${fill}"/>${text(size / 2, Math.round(size * 0.74), '验', { size: Math.round(size * 0.66), fill: ink, weight: 700, anchor: 'middle' })}</g>`;
}

/** Verdict glyph inside a ring: ✓ consistent, ✕ inconsistent, – inconclusive. Drawn as paths, no font needed. */
export function glyph(cx: number, cy: number, R: number, verdict: Verdict, color: string): string {
  const sw = (R * 0.15).toFixed(1);
  const f = (n: number) => (n * R).toFixed(1);
  const mark =
    verdict === 'consistent'
      ? `<path d="M${f(-0.42)} ${f(0.02)} L${f(-0.12)} ${f(0.32)} L${f(0.44)} ${f(-0.3)}"/>`
      : verdict === 'inconsistent'
        ? `<path d="M${f(-0.3)} ${f(-0.3)} L${f(0.3)} ${f(0.3)} M${f(0.3)} ${f(-0.3)} L${f(-0.3)} ${f(0.3)}"/>`
        : `<path d="M${f(-0.34)} 0 L${f(0.34)} 0"/>`;
  return `<g transform="translate(${cx} ${cy})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><circle r="${f(0.92)}" stroke-width="${(R * 0.08).toFixed(1)}"/>${mark}</g>`;
}

export function svgOpen(title: string, bg: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="${CARD_FONT_STACK}">
  <title>${esc(title)}</title>
  <rect width="${CARD_W}" height="${CARD_H}" fill="${bg}"/>`;
}

/** The decisive number: optional muted prefix ("p"), the value, optional unit, in one text run sized to fit maxPx. */
export function bigNumber(x: number, y: number, m: CardModel, maxPx: number, maxSize: number, o: { fill: string; muted: string; family: string; mono: boolean }): string {
  const unitRatio = 0.36;
  const prefixRatio = 0.62;
  const est = (size: number) =>
    textWidth(m.big, size, true, o.mono) +
    (m.prefix ? textWidth(m.prefix + ' ', size * prefixRatio, false, o.mono) + size * 0.2 : 0) +
    (m.unit ? textWidth(m.unit, size * unitRatio) + size * 0.2 : 0);
  let size = maxSize;
  while (size > 16 && est(size) > maxPx) size -= 2;
  const big = fitText(m.big, maxPx, size, true, o.mono);
  const pre = m.prefix ? `<tspan font-size="${Math.round(size * prefixRatio)}" font-weight="500" fill="${o.muted}">${esc(m.prefix)}</tspan><tspan dx="${Math.round(size * 0.2)}">${esc(big)}</tspan>` : esc(big);
  const unit = m.unit ? `<tspan dx="${Math.round(size * 0.2)}" font-size="${Math.round(size * unitRatio)}" font-weight="500" fill="${o.muted}" font-family="${CARD_FONT_STACK}">${esc(m.unit)}</tspan>` : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="700" fill="${o.fill}" font-family="${o.family}" data-role="decisive">${pre}${unit}</text>`;
}


/** FNV-1a hash → 8 base-36 characters, upper case. */
export function serialOf(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let h2 = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return (h.toString(36) + h2.toString(36)).toUpperCase().padStart(8, '0').slice(0, 8);
}
