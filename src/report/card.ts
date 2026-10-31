import { hostOf } from '../redact.js';
import { groupName } from '../run.js';
import { formatP } from '../stats.js';
import type { GroupId, GroupResult, Lang, Report, Status, Verdict } from '../types.js';
import { esc } from './html.js';

/**
 * Share card: a 1200×630 result image, built like a speed-test result card.
 * Level 1 is the verdict, level 2 the claimed model and the one number that decided it,
 * level 3 four status chips and a small footer. Pure SVG string, zero runtime deps.
 *
 * Two designs: 'ink' (dark, matches the terminal demo) and 'stamp' (light, Swiss, verdict block).
 */
export type CardStyle = 'ink' | 'stamp';
export const CARD_STYLES: CardStyle[] = ['ink', 'stamp'];
export const DEFAULT_CARD_STYLE: CardStyle = 'stamp';

export interface CardOptions {
  /** primary language; the other one appears once, small, under the verdict */
  lang?: Lang;
  style?: CardStyle;
  showHost?: boolean;
}

export const CARD_W = 1200;
export const CARD_H = 630;
export const REPO = 'github.com/YanYunCY/relaycheck';

const CJK_FONTS = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei'";
/** Font stack: Latin UI fonts first, then CJK fonts for every platform, so Chinese never falls back to tofu. */
export const CARD_FONT_STACK = `Inter, system-ui, -apple-system, 'Segoe UI', ${CJK_FONTS}, Roboto, 'Helvetica Neue', Arial, sans-serif`;
const DISPLAY_STACK = `'Inter Display', ${CARD_FONT_STACK}`;
export const CARD_MONO_STACK = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', ${CJK_FONTS}, monospace`;

const VERDICT: Record<Verdict, { zh: string; en: string }> = {
  consistent: { zh: '一致', en: 'CONSISTENT' },
  inconsistent: { zh: '不一致', en: 'INCONSISTENT' },
  inconclusive: { zh: '存疑', en: 'INCONCLUSIVE' },
};
const STATUS_WORD: Record<Status, { zh: string; en: string }> = {
  pass: { zh: '通过', en: 'Pass' },
  fail: { zh: '失败', en: 'Fail' },
  warn: { zh: '存疑', en: 'Warn' },
  skip: { zh: '跳过', en: 'Skip' },
  info: { zh: '信息', en: 'Info' },
};
const GROUPS: GroupId[] = ['identity', 'protocol', 'billing', 'context'];

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

function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = /\d{4}-\d{2}-\d{2}/.exec(iso);
    return m ? m[0] : '';
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- content model (shared by both styles)

interface CardModel {
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
}

const T = {
  model: { zh: '声称模型', en: 'Claimed model' },
  pLabel: { zh: '身份检验 p 值', en: 'Identity p-value' },
  uncal: { zh: '（未校准）', en: ' (uncalibrated)' },
  synthetic: { zh: ' · 合成参考', en: ' · synthetic ref' },
  injLabel: { zh: '每个请求多计的隐藏输入 token', en: 'Hidden input tokens billed per request' },
  injUnit: { zh: 'tokens/请求', en: 'tokens/req' },
  passLabel: { zh: '检查组通过', en: 'Check groups passed' },
  hostHidden: { zh: '主机已隐藏', en: 'host hidden' },
};

function cardModel(r: Report, lang: Lang, showHost: boolean): CardModel {
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
  const idDecides = st('identity') === 'fail' || st('identity') === 'warn' || r.verdict === 'consistent';
  if (r.injectedTokens && r.injectedTokens > 0) {
    big = `+${r.injectedTokens}`;
    unit = T.injUnit[lang];
    bigLabel = T.injLabel[lang];
  } else if (r.pValue !== null && r.pValue !== undefined && idDecides) {
    prefix = 'p =';
    big = formatP(r.pValue);
    bigLabel = T.pLabel[lang] + (r.calibrated ? '' : T.uncal[lang]) + (r.reference?.synthetic ? T.synthetic[lang] : '');
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
  };
}

// ---------------------------------------------------------------- svg helpers

interface TextOpts {
  size: number;
  fill: string;
  weight?: number;
  anchor?: 'start' | 'middle' | 'end';
  family?: string;
  spacing?: number;
  opacity?: number;
}
function text(x: number, y: number, s: string, o: TextOpts): string {
  const a = [`x="${x}"`, `y="${y}"`, `font-size="${o.size}"`, `fill="${o.fill}"`];
  if (o.weight) a.push(`font-weight="${o.weight}"`);
  if (o.anchor && o.anchor !== 'start') a.push(`text-anchor="${o.anchor}"`);
  if (o.family) a.push(`font-family="${o.family}"`);
  if (o.spacing) a.push(`letter-spacing="${o.spacing}"`);
  if (o.opacity !== undefined) a.push(`fill-opacity="${o.opacity}"`);
  return `<text ${a.join(' ')}>${esc(s)}</text>`;
}

/** The relaycheck mark: a small square seal carrying 验. */
function seal(x: number, y: number, size: number, fill: string, ink: string): string {
  return `<g transform="translate(${x} ${y})"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="${fill}"/>${text(size / 2, Math.round(size * 0.74), '验', { size: Math.round(size * 0.66), fill: ink, weight: 700, anchor: 'middle' })}</g>`;
}

/** Verdict glyph inside a ring: ✓ consistent, ✕ inconsistent, – inconclusive. Drawn as paths, no font needed. */
function glyph(cx: number, cy: number, R: number, verdict: Verdict, color: string): string {
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

function svgOpen(title: string, bg: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="${CARD_FONT_STACK}">
  <title>${esc(title)}</title>
  <rect width="${CARD_W}" height="${CARD_H}" fill="${bg}"/>`;
}

/** The decisive number: optional muted prefix ("p"), the value, optional unit, in one text run sized to fit maxPx. */
function bigNumber(x: number, y: number, m: CardModel, maxPx: number, maxSize: number, o: { fill: string; muted: string; family: string; mono: boolean }): string {
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

// ---------------------------------------------------------------- style A: ink (dark)

const INK = {
  bg: '#0d1117',
  surface: '#161b22',
  line: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  faint: '#6e7681',
  verdict: { consistent: '#3fdc7a', inconsistent: '#ff6b6b', inconclusive: '#f2c94c' } as Record<Verdict, string>,
  status: { pass: '#3fdc7a', fail: '#ff6b6b', warn: '#f2c94c', skip: '#6e7681', info: '#58a6ff' } as Record<Status, string>,
};

function renderInk(m: CardModel, title: string): string {
  const M = 72;
  const R = CARD_W - M;
  const vc = INK.verdict[m.verdict];
  const mono = `font-family="${CARD_MONO_STACK}"`;
  const out: string[] = [svgOpen(title, INK.bg)];
  // a quiet verdict-tinted wash behind the verdict, the only decoration
  out.push(`  <defs><radialGradient id="wash" cx="0.18" cy="0.42" r="0.7"><stop offset="0" stop-color="${vc}" stop-opacity="0.13"/><stop offset="1" stop-color="${vc}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#wash)"/>`);
  // header: mark + wordmark, date on the right
  out.push(seal(M, 70, 34, INK.text, INK.bg));
  out.push(`<g ${mono}>${text(M + 48, 97, 'relaycheck', { size: 26, fill: INK.text, weight: 700 })}</g>`);
  out.push(`<g ${mono}>${text(R, 97, m.date, { size: 20, fill: INK.muted, anchor: 'end' })}</g>`);
  // level 1: verdict
  const vSize = fitSize(m.primary, R - M, 176);
  out.push(text(M - 4, 300, m.primary, { size: vSize, fill: vc, weight: 800, family: DISPLAY_STACK }));
  const secSize = 26;
  out.push(`<g ${mono}>${text(M, 352, fitText(m.secondary, R - M, secSize, false, true), { size: secSize, fill: vc, opacity: 0.8, spacing: m.other === 'en' ? 4 : 2 })}</g>`);
  // level 2: claimed model | decisive number
  const colB = 640;
  out.push(text(M, 420, m.modelLabel, { size: 18, fill: INK.muted }));
  const ms = fitSize(m.model, colB - M - 40, 32, true, true, 24);
  out.push(`<g ${mono}>${text(M, 470, fitText(m.model, colB - M - 40, ms, true, true), { size: ms, fill: INK.text, weight: 700 })}</g>`);
  out.push(text(colB, 420, fitText(m.bigLabel, R - colB, 18), { size: 18, fill: INK.muted }));
  out.push(bigNumber(colB, 474, m, R - colB, 56, { fill: INK.text, muted: INK.muted, family: CARD_MONO_STACK, mono: true }));
  // level 3: status chips
  const gap = 16;
  const cw = (R - M - gap * 3) / 4;
  m.chips.forEach((c, i) => {
    const x = M + i * (cw + gap);
    const sc = INK.status[c.status];
    const loud = c.status === 'fail' || c.status === 'warn';
    out.push(`<g transform="translate(${x} 512)">
  <rect width="${cw}" height="50" rx="25" fill="${loud ? sc : INK.surface}" fill-opacity="${loud ? 0.16 : 1}" stroke="${loud ? sc : INK.line}" stroke-opacity="${loud ? 0.7 : 1}"/>
  <circle cx="26" cy="25" r="6" fill="${sc}"/>
  ${text(42, 33, fitText(c.name, cw - 42 - 70, 21, true), { size: 21, fill: INK.text, weight: 600 })}
  ${text(cw - 22, 33, c.word, { size: 19, fill: sc, weight: 700, anchor: 'end' })}
</g>`);
  });
  // footer
  out.push(text(M, 598, fitText(`${m.host}`, 400, 16), { size: 16, fill: INK.faint }));
  out.push(`<g ${mono}>${text(R, 598, REPO, { size: 16, fill: INK.faint, anchor: 'end' })}</g>`);
  out.push('</svg>\n');
  return out.join('\n  ');
}

// ---------------------------------------------------------------- style B: stamp (light, Swiss)

const STAMP = {
  bg: '#ffffff',
  ink: '#111418',
  grey: '#5b616e',
  faint: '#8a909b',
  chip: '#f2f3f5',
  verdict: { consistent: '#15803d', inconsistent: '#d92d20', inconclusive: '#b45309' } as Record<Verdict, string>,
  status: { pass: '#15803d', fail: '#d92d20', warn: '#b45309', skip: '#8a909b', info: '#2563eb' } as Record<Status, string>,
};

function renderStamp(m: CardModel, title: string): string {
  const M = 72;
  const P = m.lang === 'en' ? 600 : 504; // verdict block width (wider for the long English words)
  const X = P + 64; // right column
  const R = CARD_W - M;
  const vc = STAMP.verdict[m.verdict];
  const out: string[] = [svgOpen(title, STAMP.bg)];
  // level 1: the verdict block
  out.push(`<rect width="${P}" height="${CARD_H}" fill="${vc}"/>`);
  out.push(glyph(M + 56, 136, 60, m.verdict, '#ffffff'));
  const vSize = fitSize(m.primary, P - M - 40, 150, true);
  out.push(text(M - 3, 372, m.primary, { size: vSize, fill: '#ffffff', weight: 800, family: DISPLAY_STACK }));
  const sec = fitText(m.secondary, P - M - 40, 26, true);
  out.push(text(M, 424, sec, { size: 26, fill: '#ffffff', weight: 700, opacity: 0.78, spacing: m.other === 'en' ? 3 : 2 }));
  out.push(seal(M, 538, 34, '#ffffff', vc));
  out.push(text(M + 48, 565, 'relaycheck', { size: 26, fill: '#ffffff', weight: 700 }));
  // level 2: model, then the decisive number large
  out.push(text(X, 116, m.modelLabel, { size: 20, fill: STAMP.grey }));
  const ms = fitSize(m.model, R - X, Math.min(40, Math.floor(vSize / 2)), true, false, 24);
  out.push(text(X, 166, fitText(m.model, R - X, ms, true), { size: ms, fill: STAMP.ink, weight: 700 }));
  out.push(`<rect x="${X}" y="200" width="${R - X}" height="2" fill="${STAMP.ink}"/>`);
  out.push(text(X, 252, fitText(m.bigLabel, R - X, 20), { size: 20, fill: STAMP.grey }));
  out.push(bigNumber(X - 3, 336, m, R - X, Math.min(80, Math.round(vSize * 0.9)), { fill: STAMP.ink, muted: STAMP.grey, family: DISPLAY_STACK, mono: false }));
  if (m.reason) out.push(text(X, 384, fitText(m.reason, R - X, 20), { size: 20, fill: STAMP.ink }));
  // level 3: chips as a 2×2 grid
  const gap = 12;
  const cw = (R - X - gap) / 2;
  m.chips.forEach((c, i) => {
    const x = X + (i % 2) * (cw + gap);
    const y = 432 + Math.floor(i / 2) * (48 + gap);
    const sc = STAMP.status[c.status];
    const loud = c.status === 'fail' || c.status === 'warn';
    out.push(`<g transform="translate(${x} ${y})">
  <rect width="${cw}" height="48" rx="6" fill="${loud ? sc : STAMP.chip}"/>
  <rect x="18" y="18" width="12" height="12" rx="2" fill="${loud ? '#ffffff' : sc}"/>
  ${text(44, 32, fitText(c.name, cw - 44 - 64, 20, true), { size: 20, fill: loud ? '#ffffff' : STAMP.ink, weight: 600 })}
  ${text(cw - 18, 32, c.word, { size: 18, fill: loud ? '#ffffff' : sc, weight: 700, anchor: 'end' })}
</g>`);
  });
  // footer
  out.push(text(X, 588, fitText(`${m.date}  ·  ${m.host}`, 260, 16), { size: 16, fill: STAMP.faint }));
  out.push(text(R, 588, REPO, { size: 16, fill: STAMP.faint, anchor: 'end' }));
  out.push('</svg>\n');
  return out.join('\n  ');
}

// ---------------------------------------------------------------- entry point

/** 1200×630 bilingual SVG report card for sharing. Host is hidden unless showHost. */
export function renderCard(r: Report, showHostOrOpts: boolean | CardOptions = false, maybeOpts: CardOptions = {}): string {
  const opts: CardOptions = typeof showHostOrOpts === 'boolean' ? { ...maybeOpts, showHost: showHostOrOpts } : showHostOrOpts;
  const lang: Lang = opts.lang ?? 'zh';
  const style: CardStyle = opts.style ?? DEFAULT_CARD_STYLE;
  const m = cardModel(r, lang, !!opts.showHost);
  const v = VERDICT[r.verdict];
  const title = `relaycheck: ${v.zh} ${v.en} · ${r.target.model}`;
  return style === 'ink' ? renderInk(m, title) : renderStamp(m, title);
}

/** Parse an internal style name (e.g. from $RELAYCHECK_CARD_STYLE); unknown values fall back to the default. */
export function cardStyleOf(v: string | undefined): CardStyle {
  const s = (v ?? '').toLowerCase();
  if (s === 'ink' || s === 'a') return 'ink';
  if (s === 'stamp' || s === 'b') return 'stamp';
  return DEFAULT_CARD_STYLE;
}
