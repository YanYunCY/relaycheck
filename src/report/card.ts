import type { Lang, Report, Status, Verdict } from '../types.js';
import {
  CARD_FONT_STACK,
  CARD_H,
  CARD_MONO_STACK,
  CARD_W,
  DISPLAY_STACK,
  REPO,
  VERDICT,
  bigNumber,
  cardModel,
  fitSize,
  fitText,
  glyph,
  seal,
  svgOpen,
  text,
  type CardModel,
} from './card-kit.js';
import { renderLab, renderNight, renderSlip } from './card-styles.js';

export { CARD_FONT_STACK, CARD_H, CARD_MONO_STACK, CARD_W, REPO, fitSize, fitText, textWidth } from './card-kit.js';

/**
 * Share card: a 1200×630 result image, built like a speed-test result card.
 * Level 1 is the verdict, level 2 the claimed model and the one number that decided it,
 * level 3 four status chips and a small footer. Pure SVG string, zero runtime deps.
 *
 * Designs: round 2 'slip' (验货单 with an ink chop), 'lab' (test certificate), 'night' (dark, glow);
 * round 1 'ink' (dark, terminal) and 'stamp' (light, verdict block) stay selectable.
 */
export type CardStyle = 'slip' | 'lab' | 'night' | 'ink' | 'stamp';
export const CARD_STYLES: CardStyle[] = ['slip', 'lab', 'night', 'ink', 'stamp'];
export const DEFAULT_CARD_STYLE: CardStyle = 'slip';

export interface CardOptions {
  /** primary language; the other one appears once, small, under the verdict */
  lang?: Lang;
  style?: CardStyle;
  showHost?: boolean;
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
  const render = { slip: renderSlip, lab: renderLab, night: renderNight, ink: renderInk, stamp: renderStamp }[style] ?? renderSlip;
  return render(m, title);
}

/** Parse an internal style name (e.g. from $RELAYCHECK_CARD_STYLE); unknown values fall back to the default. */
export function cardStyleOf(v: string | undefined): CardStyle {
  const s = (v ?? '').toLowerCase();
  if (s === 'ink' || s === 'a') return 'ink';
  if (s === 'stamp' || s === 'b') return 'stamp';
  if (s === 'slip' || s === 'lab' || s === 'night') return s;
  return DEFAULT_CARD_STYLE;
}
