import type { Status, Verdict } from '../types.js';
import { esc } from './html.js';
import { CARD_FONT_STACK, CARD_H, CARD_MONO_STACK, CARD_W, REPO, fitText, svgOpen, text, textWidth, type CardModel } from './card-kit.js';
import { CAPS_GLYPHS, HEI_GLYPHS, SEAL_GLYPHS, SONG_GLYPHS } from './glyphs.js';

/**
 * Round-2 share card designs. All decorative glyphs (verdict words, seal text) are drawn from
 * embedded outlines (glyphs.ts), so the hero never depends on the viewer's fonts. Ink texture and
 * paper grain are SVG filters (feTurbulence + feDisplacementMap); no raster images.
 *
 *  slip  · 验货单: an inspection slip with a perforated stub and a real-ink verdict chop
 *  lab   · 检测报告: a test certificate with guilloché frame, p-value scale and a round seal
 *  night · dark, the demo GIF's palette with glow, grain, frame lines and registration marks
 */

// ---------------------------------------------------------------- drawn words

type GlyphSet = 'seal' | 'hei' | 'song';
const SETS: Record<GlyphSet, Record<string, string>> = { seal: SEAL_GLYPHS, hei: HEI_GLYPHS, song: SONG_GLYPHS };
const CAP_H = 0.727; // Inter Display cap height, in em

/** True when every character of the word has an embedded outline. */
function drawable(word: string, set: GlyphSet): boolean {
  return [...word].every((ch) => (ch in SETS[set]) || (ch in CAPS_GLYPHS) || ch === ' ');
}
const isCaps = (word: string) => /^[A-Z ]+$/.test(word);

/** Width (px) of a drawn word: CJK glyphs are 1 em; caps use their advances. `track` is in px. */
export function wordWidth(word: string, size: number, track = 0): number {
  const chars = [...word];
  let w = 0;
  for (const ch of chars) w += ch === ' ' ? size * 0.28 : isCaps(ch) ? ((CAPS_GLYPHS[ch]?.w ?? 700) / 1000) * size : size;
  return w + track * Math.max(0, chars.length - 1);
}
/** Height (px) of a drawn word's visual box (1 em for CJK, cap height for caps). */
const wordHeight = (word: string, size: number) => (isCaps(word) ? size * CAP_H : size);

/**
 * Draw a word as paths with its visual box's top-left at (x, top). Falls back to a <text> run
 * for characters without an outline (never happens for the verdict words).
 */
export function drawWord(word: string, x: number, top: number, size: number, set: GlyphSet, fill: string, track = 0, extra = '', color = fill): string {
  if (!drawable(word, set)) {
    return `<text x="${r1(x)}" y="${r1(top + size * 0.88)}" font-size="${size}" font-weight="800" fill="${fill}"${extra}>${esc(word)}</text>`;
  }
  const s = size / 1000;
  const parts: string[] = [];
  let cx = x;
  for (const ch of word) {
    if (ch === ' ') {
      cx += size * 0.28 + track;
      continue;
    }
    if (isCaps(ch)) {
      const g = CAPS_GLYPHS[ch]!;
      parts.push(`<path transform="translate(${r1(cx)} ${r1(top + size * CAP_H)}) scale(${r4(s)})" d="${g.d}"/>`);
      cx += (g.w / 1000) * size + track;
    } else {
      parts.push(`<path transform="translate(${r1(cx)} ${r1(top)}) scale(${r4(s)})" d="${SETS[set][ch]}"/>`);
      cx += size + track;
    }
  }
  // data-* attributes describe the drawn word (em size, unrotated extent, colour) for tests and tooling
  return `<g fill="${fill}" data-role="verdict" data-word="${esc(word)}" data-size="${r1(size)}" data-x="${r1(x)}" data-w="${r1(wordWidth(word, size, track))}" data-color="${color}"${extra}>${parts.join('')}</g>`;
}

const r1 = (n: number) => String(Math.round(n * 10) / 10);
const r4 = (n: number) => String(Math.round(n * 10000) / 10000);

// ---------------------------------------------------------------- textures

/**
 * Real-ink look: edges roughened by low-frequency displacement, a fine speckle that leaves tiny
 * unprinted holes, and a slow blotch that varies the pressure across the impression.
 */
function inkFilter(id: string, seed: number, rough = 4.5): string {
  return `<filter id="${id}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="${seed}" result="warp"/>
    <feDisplacementMap in="SourceGraphic" in2="warp" scale="${rough}" xChannelSelector="R" yChannelSelector="G" result="edge"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" seed="${seed + 1}" result="fine"/>
    <feColorMatrix in="fine" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -14 0 0 0 9.6" result="speck"/>
    <feComposite in="edge" in2="speck" operator="in" result="specked"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="2" seed="${seed + 2}" result="blot"/>
    <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 0.05" result="press"/>
    <feComposite in="specked" in2="press" operator="in"/>
  </filter>`;
}

/** Paper/film grain as an overlay: monochrome noise at low alpha. */
function grainFilter(id: string, tone: 'dark' | 'light', amount: number, freq = 0.9): string {
  const c = tone === 'light' ? '1 1 1' : '0 0 0';
  const [r, g, b] = c.split(' ');
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="4" stitchTiles="stitch" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${amount * 2.4} 0 0 0 ${-amount * 0.9}"/>
  </filter>`;
}

// ---------------------------------------------------------------- small marks

/** Check / cross / dash mark drawn as strokes in a unit box of side s, top-left (x, y). */
function mark(x: number, y: number, s: number, status: Status, color: string, sw = 2.4): string {
  const f = (a: number) => r1(a * s);
  const d =
    status === 'pass' || status === 'info'
      ? `M${f(0.2)} ${f(0.52)} L${f(0.42)} ${f(0.74)} L${f(0.82)} ${f(0.26)}`
      : status === 'fail'
        ? `M${f(0.24)} ${f(0.24)} L${f(0.76)} ${f(0.76)} M${f(0.76)} ${f(0.24)} L${f(0.24)} ${f(0.76)}`
        : status === 'warn'
          ? `M${f(0.5)} ${f(0.2)} L${f(0.5)} ${f(0.58)} M${f(0.5)} ${f(0.78)} L${f(0.5)} ${f(0.8)}`
          : `M${f(0.26)} ${f(0.5)} L${f(0.74)} ${f(0.5)}`;
  return `<path transform="translate(${r1(x)} ${r1(y)})" d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Registration / crop mark: a small plus. */
function plus(x: number, y: number, s: number, color: string, op = 1): string {
  return `<path d="M${x - s} ${y}H${x + s}M${x} ${y - s}V${y + s}" stroke="${color}" stroke-width="1" stroke-opacity="${op}"/>`;
}

/** Decorative barcode from the slip number (bars only, not a scannable symbology). */
function barcode(x: number, y: number, w: number, h: number, seed: string, color: string): string {
  const units: number[] = [2, 1, 1, 1]; // start guard
  for (const ch of seed) {
    const c = ch.charCodeAt(0);
    units.push(1 + (c % 3), 1 + ((c >> 2) % 2), 1 + ((c >> 3) % 3), 1 + ((c >> 1) % 2));
  }
  units.push(1, 1, 2, 1);
  const total = units.reduce((a, b) => a + b, 0);
  const u = w / total;
  let cx = x;
  const out: string[] = [];
  units.forEach((n, i) => {
    if (i % 2 === 0) out.push(`<rect x="${r1(cx)}" y="${y}" width="${r1(n * u)}" height="${h}"/>`);
    cx += n * u;
  });
  return `<g fill="${color}">${out.join('')}</g>`;
}

// ---------------------------------------------------------------- p-value scale

const DECADES = 8;
/** Position (0..1) of a p-value on a log scale from 1 (left) to 1e-8 (right). */
export function pPos(p: number): number {
  if (!(p > 0)) return 1;
  return Math.max(0, Math.min(1, -Math.log10(p) / DECADES));
}

interface MeterColors {
  track: string;
  pass: string;
  warn: string;
  fail: string;
  label: string;
  marker: string;
}
/** A log-scale ruler: green / amber / red zones at p = 0.01 and 0.001, decade ticks, marker at p. */
function meter(x: number, y: number, w: number, p: number, c: MeterColors, o: { glow?: string; labelSize?: number } = {}): string {
  const X = (t: number) => x + t * w;
  const a = X(2 / DECADES);
  const b = X(3 / DECADES);
  const ls = o.labelSize ?? 13;
  const out: string[] = [];
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="4" fill="${c.track}"/>`);
  out.push(`<rect x="${x}" y="${y}" width="${r1(a - x)}" height="4" fill="${c.pass}"/>`);
  out.push(`<rect x="${r1(a)}" y="${y}" width="${r1(b - a)}" height="4" fill="${c.warn}"/>`);
  out.push(`<rect x="${r1(b)}" y="${y}" width="${r1(x + w - b)}" height="4" fill="${c.fail}"/>`);
  for (let k = 0; k <= DECADES; k++) {
    const tx = X(k / DECADES);
    const major = k % 2 === 0;
    out.push(`<rect x="${r1(tx - 0.5)}" y="${y + 8}" width="1" height="${major ? 8 : 4}" fill="${c.label}"/>`);
    if (major) out.push(text(Math.round(tx * 10) / 10, y + 18 + ls + 2, k === 0 ? '1' : `1e-${k}`, { size: ls, fill: c.label, anchor: k === 0 ? 'start' : k === DECADES ? 'end' : 'middle', family: CARD_MONO_STACK }));
  }
  const mx = X(pPos(p));
  if (o.glow) out.push(`<circle cx="${r1(mx)}" cy="${y + 2}" r="10" fill="${o.glow}" fill-opacity="0.35" filter="url(#soft)"/>`);
  out.push(`<path d="M${r1(mx - 7)} ${y - 13}L${r1(mx + 7)} ${y - 13}L${r1(mx)} ${y - 3}Z" fill="${c.marker}"/>`);
  out.push(`<rect x="${r1(mx - 1)}" y="${y - 3}" width="2" height="10" fill="${c.marker}"/>`);
  return `<g data-role="meter">${out.join('')}</g>`;
}

// ---------------------------------------------------------------- the verdict chop

interface ChopOpts {
  cx: number;
  cy: number;
  angle: number;
  color: string;
  filter: string;
  word: string;
  set: GlyphSet;
  maxW: number;
  size: number;
  footer: string;
}
/** A rectangular inspection chop: heavy outer border, hairline inner border, drawn verdict, dated footer band. */
function chop(o: ChopOpts): { svg: string; w: number; h: number } {
  const caps = isCaps(o.word);
  const tr = caps ? 0.03 : 0.06;
  let size = o.size;
  while (size > 24 && wordWidth(o.word, size, size * tr) > o.maxW) size -= 2;
  const ww = wordWidth(o.word, size, size * tr);
  const wh = wordHeight(o.word, size);
  const padX = caps ? 34 : 26;
  const padY = caps ? 30 : 20;
  const band = 40;
  const W = ww + padX * 2;
  const H = wh + padY * 2 + band;
  const x0 = -W / 2;
  const y0 = -H / 2;
  const parts: string[] = [];
  parts.push(`<rect x="${r1(x0 + 4)}" y="${r1(y0 + 4)}" width="${r1(W - 8)}" height="${r1(H - 8)}" rx="6" fill="none" stroke="${o.color}" stroke-width="8"/>`);
  parts.push(`<rect x="${r1(x0 + 14)}" y="${r1(y0 + 14)}" width="${r1(W - 28)}" height="${r1(H - 28)}" rx="2" fill="none" stroke="${o.color}" stroke-width="2"/>`);
  parts.push(drawWord(o.word, x0 + padX, y0 + padY + 2, size, o.set, o.color, size * tr, o.set === 'seal' ? ` stroke="${o.color}" stroke-width="${r1(size * 0.035)}" stroke-linejoin="round"` : ''));
  const by = y0 + H - band - 6;
  parts.push(`<rect x="${r1(x0 + 14)}" y="${r1(by)}" width="${r1(W - 28)}" height="2" fill="${o.color}"/>`);
  parts.push(`<text x="0" y="${r1(by + 27)}" font-size="16" font-weight="700" fill="${o.color}" text-anchor="middle" letter-spacing="3" font-family="${CARD_MONO_STACK}">${esc(o.footer)}</text>`);
  const svg = `<g transform="translate(${r1(o.cx)} ${r1(o.cy)}) rotate(${o.angle})" data-role="chop"><g filter="url(#${o.filter})" opacity="0.92" style="mix-blend-mode:multiply">${parts.join('')}</g></g>`;
  return { svg, w: W, h: H };
}

/** Verdict word for the primary language, and the glyph set it is drawn from. */
const heroWord = (m: CardModel) => m.primary;

// ================================================================ style: slip (验货单)

const SLIP = {
  ground: '#e4dfd4',
  paper: '#fbf9f4',
  ink: '#1c1b18',
  grey: '#6f6a60',
  faint: '#9d978b',
  rule: '#d9d3c6',
  verdict: { consistent: '#1f7a4c', inconsistent: '#cf3a2b', inconclusive: '#b8761c' } as Record<Verdict, string>,
  status: { pass: '#1f7a4c', fail: '#cf3a2b', warn: '#b8761c', skip: '#9d978b', info: '#2f5ea8' } as Record<Status, string>,
};
const SLIP_T = {
  slip: { zh: '验货单', en: 'Inspection slip' },
  no: { zh: '编号', en: 'No.' },
};

export function renderSlip(m: CardModel, title: string): string {
  const vc = SLIP.verdict[m.verdict];
  const mono = CARD_MONO_STACK;
  const L = 84; // main column left
  const D = 800; // perforation x
  const MR = D - 48; // main column right
  const out: string[] = [svgOpen(title, SLIP.ground)];
  out.push(`<defs>
    ${inkFilter('ink', m.verdict === 'consistent' ? 21 : m.verdict === 'inconsistent' ? 7 : 13)}
    ${grainFilter('grain', 'dark', 0.06, 0.85)}
    <filter id="lift" x="-5%" y="-5%" width="110%" height="115%"><feGaussianBlur in="SourceAlpha" stdDeviation="10"/><feOffset dy="8"/><feColorMatrix type="matrix" values="0 0 0 0 0.2  0 0 0 0 0.16  0 0 0 0 0.1  0 0 0 0.22 0"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`);
  // the slip: paper with two punched notches at the perforation
  const x0 = 34;
  const y0 = 30;
  const x1 = CARD_W - 34;
  const y1 = CARD_H - 34;
  const nr = 15;
  const paper = `M${x0 + 10} ${y0}H${D - nr}A${nr} ${nr} 0 0 0 ${D + nr} ${y0}H${x1 - 10}Q${x1} ${y0} ${x1} ${y0 + 10}V${y1 - 10}Q${x1} ${y1} ${x1 - 10} ${y1}H${D + nr}A${nr} ${nr} 0 0 0 ${D - nr} ${y1}H${x0 + 10}Q${x0} ${y1} ${x0} ${y1 - 10}V${y0 + 10}Q${x0} ${y0} ${x0 + 10} ${y0}Z`;
  out.push(`<path d="${paper}" fill="${SLIP.paper}" filter="url(#lift)"/>`);
  out.push(`<path d="${paper}" fill="#000" filter="url(#grain)"/>`);
  out.push(`<path d="M${D} ${y0 + nr + 10}V${y1 - nr - 10}" stroke="${SLIP.faint}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>`);

  // header: mark + wordmark | form title
  out.push(`<g transform="translate(${L} 74)"><rect width="34" height="34" rx="7" fill="${SLIP.ink}"/>${drawWord('验', 5, 5, 24, 'seal', SLIP.paper).replace(/ data-role="verdict"[^>]*data-color="[^"]*"/, '')}</g>`);
  out.push(text(L + 48, 100, 'relaycheck', { size: 25, fill: SLIP.ink, weight: 700, family: mono }));
  out.push(text(MR, 99, SLIP_T.slip[m.lang] + (m.lang === 'zh' ? '  INSPECTION SLIP' : ''), { size: 15, fill: SLIP.grey, anchor: 'end', family: mono, spacing: 1.5 }));
  out.push(`<rect x="${L}" y="128" width="${MR - L}" height="2" fill="${SLIP.ink}"/><rect x="${L}" y="134" width="${MR - L}" height="1" fill="${SLIP.ink}"/>`);

  // level 2: claimed model, then the decisive number
  out.push(text(L, 180, m.modelLabel, { size: 17, fill: SLIP.grey }));
  const ms = Math.min(m.lang === 'en' ? 28 : 36, Math.max(22, Math.floor((MR - L) / Math.max(1, textWidth(m.model, 1, true, true)))));
  out.push(text(L, 226, fitText(m.model, MR - L, ms, true, true), { size: ms, fill: SLIP.ink, weight: 700, family: mono }));
  out.push(`<path d="M${L} 258H${MR}" stroke="${SLIP.rule}" stroke-width="1.5" stroke-dasharray="1 5" stroke-linecap="round"/>`);
  out.push(text(L, 300, fitText(m.bigLabel, 560 - L, 17), { size: 17, fill: SLIP.grey }));
  const numMax = 520 - L;
  out.push(slipNumber(L - 2, 372, m, numMax, m.lang === 'en' ? 54 : 66, SLIP.ink, SLIP.grey));
  if (m.kind === 'p' && m.p !== null) {
    out.push(meter(L, 418, 470, m.p, { track: SLIP.rule, pass: SLIP.status.pass, warn: SLIP.status.warn, fail: SLIP.status.fail, label: SLIP.faint, marker: SLIP.ink }, { labelSize: 12 }));
  } else if (m.reason) {
    out.push(text(L, 420, fitText(m.reason, 520 - L, 18), { size: 18, fill: SLIP.ink }));
  }
  out.push(`<path d="M${L} 472H${MR}" stroke="${SLIP.rule}" stroke-width="1.5" stroke-dasharray="1 5" stroke-linecap="round"/>`);

  // level 3: four checkboxes, as on a paper form
  const cw = (MR - L) / 4;
  m.chips.forEach((c, i) => {
    const x = L + i * cw;
    const sc = SLIP.status[c.status];
    const loud = c.status === 'fail' || c.status === 'warn';
    out.push(`<g transform="translate(${r1(x)} 500)">
  <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="3" fill="${loud ? sc : 'none'}" fill-opacity="${loud ? 0.1 : 0}" stroke="${loud ? sc : SLIP.ink}" stroke-width="1.5"/>
  ${mark(1, 1, 26, c.status, sc, 3)}
  ${text(38, 21, fitText(c.name, cw - 44, 19, true), { size: 19, fill: loud ? sc : SLIP.ink, weight: 600 })}
</g>`);
  });
  out.push(text(L, 568, fitText(`${m.date}  ·  ${m.host}  ·  v${m.version}`, MR - L, 14, false, true), { size: 14, fill: SLIP.faint, family: mono }));

  // stub: number, the chop, barcode
  const SL = D + 40;
  const SR = x1 - 40;
  out.push(text(SL, 100, SLIP_T.no[m.lang], { size: 15, fill: SLIP.grey, family: mono }));
  out.push(text(SR, 100, m.serial, { size: 22, fill: SLIP.ink, weight: 700, family: mono, anchor: 'end', spacing: 1 }));
  out.push(`<rect x="${SL}" y="128" width="${SR - SL}" height="2" fill="${SLIP.ink}"/><rect x="${SL}" y="134" width="${SR - SL}" height="1" fill="${SLIP.ink}"/>`);
  out.push(text((SL + SR) / 2, 448, fitText(m.secondary, SR - SL, 17, true, true), { size: 17, fill: vc, weight: 700, family: mono, anchor: 'middle', spacing: m.other === 'en' ? 4 : 6 }));
  out.push(barcode(SL, 486, SR - SL, 50, m.serial + m.date, SLIP.ink));
  out.push(text(SR, 568, REPO, { size: 13, fill: SLIP.faint, family: mono, anchor: 'end' }));
  const word = heroWord(m);
  const isEn = m.lang === 'en';
  const c = chop({
    cx: isEn ? 846 : 958,
    cy: 288,
    angle: isEn ? -7 : -9,
    color: vc,
    filter: 'ink',
    word,
    set: 'hei',
    maxW: isEn ? 540 : 330,
    size: isEn ? 120 : [...word].length > 2 ? 100 : 120,
    footer: `RELAYCHECK · ${m.date.replace(/-/g, '.')}`,
  });
  out.push(c.svg);
  out.push('</svg>\n');
  return out.join('\n  ');
}

/** "p = 8.3e-6" / "+512 tokens/请求" / "3/4" with a muted prefix and unit, sized to fit. */
function slipNumber(x: number, y: number, m: CardModel, maxPx: number, maxSize: number, fill: string, muted: string, family = CARD_MONO_STACK): string {
  const est = (size: number) =>
    textWidth(m.big, size, true, true) + (m.prefix ? textWidth(m.prefix, size * 0.55, false, true) + size * 0.22 : 0) + (m.unit ? textWidth(m.unit, size * 0.3) + size * 0.2 : 0);
  let size = maxSize;
  while (size > 16 && est(size) > maxPx) size -= 2;
  const big = fitText(m.big, maxPx, size, true, true);
  const pre = m.prefix ? `<tspan font-size="${Math.round(size * 0.55)}" font-weight="400" fill="${muted}">${esc(m.prefix)}</tspan><tspan dx="${Math.round(size * 0.22)}">${esc(big)}</tspan>` : esc(big);
  const unit = m.unit ? `<tspan dx="${Math.round(size * 0.2)}" font-size="${Math.round(size * 0.3)}" font-weight="500" fill="${muted}" font-family="${CARD_FONT_STACK}">${esc(m.unit)}</tspan>` : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="700" fill="${fill}" font-family="${family}" letter-spacing="-1" data-role="decisive">${pre}${unit}</text>`;
}

// ================================================================ style: lab (检测报告)

const LAB = {
  paper: '#fbfaf6',
  ink: '#16181d',
  grey: '#5f636c',
  faint: '#979ba3',
  rule: '#d8d9dc',
  guilloche: '#9fb3c8',
  seal: '#c8352b',
  verdict: { consistent: '#17663f', inconsistent: '#c8352b', inconclusive: '#a8660f' } as Record<Verdict, string>,
  status: { pass: '#17663f', fail: '#c8352b', warn: '#a8660f', skip: '#979ba3', info: '#2f5ea8' } as Record<Status, string>,
};
const LAB_T = {
  report: { zh: '检测报告', en: 'Test report' },
  result: { zh: '检测结论', en: 'Result' },
};

/** Guilloché band: phase-shifted sine strands running round a rectangle's perimeter. */
function guilloche(x: number, y: number, w: number, h: number, amp: number, color: string): string {
  const per = 2 * (w + h);
  const at = (s: number): [number, number, number, number] => {
    // point on the centre line and its inward normal
    s = ((s % per) + per) % per;
    if (s < w) return [x + s, y, 0, 1];
    if (s < w + h) return [x + w, y + (s - w), -1, 0];
    if (s < 2 * w + h) return [x + w - (s - w - h), y + h, 0, -1];
    return [x, y + h - (s - 2 * w - h), 1, 0];
  };
  const cycles = Math.round(per / 26);
  const lambda = per / cycles;
  const strands: string[] = [];
  for (let k = 0; k < 4; k++) {
    const ph = (k * Math.PI) / 2;
    const a = k % 2 === 0 ? amp : amp * 0.62;
    let d = '';
    for (let s = 0; s <= per; s += 4) {
      const [px, py, nx, ny] = at(s);
      const o = a * Math.sin((2 * Math.PI * s) / lambda + ph);
      d += `${s === 0 ? 'M' : 'L'}${Math.round((px + nx * o) * 2) / 2} ${Math.round((py + ny * o) * 2) / 2}`;
    }
    strands.push(`<path d="${d}Z"/>`);
  }
  return `<g fill="none" stroke="${color}" stroke-width="0.8" stroke-opacity="0.9">${strands.join('')}</g>`;
}

/** Round inspection seal: double ring, arc lettering from drawn caps, a five-point star and 验货 in the centre. */
function roundSeal(cx: number, cy: number, R: number, color: string, angle: number, footer: string): string {
  const parts: string[] = [];
  parts.push(`<circle r="${R - 4}" fill="none" stroke="${color}" stroke-width="7"/>`);
  parts.push(`<circle r="${R - 14}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
  // arc lettering, centred at the top
  const word = 'RELAYCHECK';
  const cap = R * 0.19;
  const em = cap / CAP_H;
  const rr = R - 22 - cap; // baseline radius
  const track = em * 0.12;
  const total = wordWidth(word, em, track);
  let a = -total / 2 / rr; // radians from top
  for (const ch of word) {
    const g = CAPS_GLYPHS[ch]!;
    const gw = (g.w / 1000) * em;
    const mid = a + gw / 2 / rr;
    const deg = (mid * 180) / Math.PI;
    parts.push(`<g transform="rotate(${r1(deg)}) translate(${r1(-gw / 2)} ${r1(-rr)}) scale(${r4(em / 1000)})"><path d="${g.d}"/></g>`);
    a += (gw + track) / rr;
  }
  // star
  const sr = R * 0.12;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? sr : sr * 0.4;
    pts.push(`${r1(Math.cos(ang) * rad)} ${r1(Math.sin(ang) * rad - R * 0.2)}`);
  }
  parts.push(`<path d="M${pts.join('L')}Z"/>`);
  const gs = R * 0.42;
  parts.push(`<g transform="translate(${r1(-gs - gs * 0.02)} ${r1(-R * 0.04)}) scale(${r4(gs / 1000)})"><path d="${SEAL_GLYPHS['验']}"/></g>`);
  parts.push(`<g transform="translate(${r1(gs * 0.02)} ${r1(-R * 0.04)}) scale(${r4(gs / 1000)})"><path d="${SEAL_GLYPHS['货']}"/></g>`);
  parts.push(`<text x="0" y="${r1(R * 0.62)}" font-size="${Math.round(R * 0.11)}" font-weight="700" text-anchor="middle" letter-spacing="1.5" font-family="${CARD_MONO_STACK}">${esc(footer)}</text>`);
  return `<g transform="translate(${cx} ${cy}) rotate(${angle})" data-role="seal"><g fill="${color}" filter="url(#ink)" opacity="0.88" style="mix-blend-mode:multiply">${parts.join('')}</g></g>`;
}

export function renderLab(m: CardModel, title: string): string {
  const vc = LAB.verdict[m.verdict];
  const mono = CARD_MONO_STACK;
  const L = 88;
  const X = 640; // right column
  const R = CARD_W - 88;
  const out: string[] = [svgOpen(title, LAB.paper)];
  out.push(`<defs>${inkFilter('ink', 5, 3.5)}${grainFilter('grain', 'dark', 0.045, 0.9)}</defs>`);
  out.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="#000" filter="url(#grain)"/>`);
  out.push(guilloche(40, 40, CARD_W - 80, CARD_H - 80, 7, LAB.guilloche));
  out.push(`<rect x="56.5" y="56.5" width="${CARD_W - 113}" height="${CARD_H - 113}" fill="none" stroke="${LAB.guilloche}" stroke-width="1"/>`);
  // header
  out.push(text(L, 112, 'relaycheck', { size: 22, fill: LAB.ink, weight: 700, family: mono }));
  out.push(text(L + 150, 112, `${LAB_T.report[m.lang]}${m.lang === 'zh' ? ' · TEST REPORT' : ''}`, { size: 16, fill: LAB.grey, spacing: 1 }));
  out.push(text(R, 112, `No. ${m.serial}`, { size: 16, fill: LAB.grey, anchor: 'end', family: mono }));
  out.push(`<rect x="${L}" y="132" width="${R - L}" height="1" fill="${LAB.ink}"/>`);
  // hero
  out.push(text(L, 182, LAB_T.result[m.lang], { size: 17, fill: LAB.grey, spacing: 2 }));
  const word = heroWord(m);
  const isEn = m.lang === 'en';
  let size = isEn ? 150 : [...word].length > 2 ? 148 : 168;
  const maxW = X - L - 56;
  while (wordWidth(word, size, size * 0.02) > maxW) size -= 2;
  out.push(drawWord(word, L - (isEn ? 4 : 6), 214, size, 'song', vc, size * 0.02));
  const hb = 214 + wordHeight(word, size);
  out.push(text(L, hb + 54, fitText(m.secondary, maxW, 22, true, true), { size: 22, fill: vc, weight: 700, family: mono, spacing: m.other === 'en' ? 5 : 3 }));
  // right column: a fine-ruled table
  const row = (y: number, label: string, value: string, color: string, vs = 22, vmono = true) => {
    out.push(text(X, y, label, { size: 16, fill: LAB.grey }));
    out.push(text(R, y, fitText(value, R - X - 150, vs, true, vmono), { size: vs, fill: color, weight: 700, anchor: 'end', family: vmono ? mono : undefined }));
    out.push(`<rect x="${X}" y="${y + 16}" width="${R - X}" height="1" fill="${LAB.rule}"/>`);
  };
  row(186, m.modelLabel, m.model, LAB.ink);
  out.push(text(X, 242, fitText(m.bigLabel, R - X, 16), { size: 16, fill: LAB.grey }));
  out.push(slipNumber(X - 2, 306, m, R - X, isEn ? 48 : 52, LAB.ink, LAB.grey));
  if (m.kind === 'p' && m.p !== null) out.push(meter(X, 340, R - X, m.p, { track: LAB.rule, pass: LAB.status.pass, warn: LAB.status.warn, fail: LAB.status.fail, label: LAB.faint, marker: LAB.ink }, { labelSize: 12 }));
  else if (m.reason) out.push(text(X, 348, fitText(m.reason, R - X, 17), { size: 17, fill: LAB.ink }));
  out.push(`<rect x="${X}" y="392" width="${R - X}" height="1" fill="${LAB.ink}"/>`);
  m.chips.forEach((c, i) => {
    const y = 422 + i * 30;
    const sc = LAB.status[c.status];
    out.push(`<g transform="translate(${X} ${y - 17})">${mark(0, 0, 22, c.status, sc, 2.4)}${text(34, 17, fitText(c.name, 200, 18, true), { size: 18, fill: LAB.ink, weight: 600 })}${text(R - X, 17, c.word, { size: 17, fill: sc, weight: 700, anchor: 'end' })}</g>`);
    if (i < 3) out.push(`<rect x="${X + 34}" y="${y + 9}" width="${R - X - 34}" height="1" fill="${LAB.rule}"/>`);
  });
  // footer + seal
  out.push(`<rect x="${L}" y="516" width="${X - L - 48}" height="1" fill="${LAB.rule}"/>`);
  out.push(text(L, 540, fitText(`${m.date}  ·  ${m.host}  ·  v${m.version}`, X - L - 48, 13, false, true), { size: 13, fill: LAB.faint, family: mono }));
  out.push(text(R, 540, REPO, { size: 13, fill: LAB.faint, family: mono, anchor: 'end' }));
  out.push(roundSeal(isEn ? 470 : 486, isEn ? 420 : 462, 86, LAB.seal, -12, m.date.replace(/-/g, '.')));
  out.push('</svg>\n');
  return out.join('\n  ');
}

// ================================================================ style: night (dark, GIF palette)

const NIGHT = {
  bg: '#0a0d12',
  text: '#eef2f6',
  muted: '#8b949e',
  faint: '#5b6470',
  line: '#ffffff',
  verdict: { consistent: '#3fdc7a', inconsistent: '#ff5d57', inconclusive: '#f2c14c' } as Record<Verdict, string>,
  status: { pass: '#3fdc7a', fail: '#ff5d57', warn: '#f2c14c', skip: '#5b6470', info: '#58a6ff' } as Record<Status, string>,
};

export function renderNight(m: CardModel, title: string): string {
  const vc = NIGHT.verdict[m.verdict];
  const mono = CARD_MONO_STACK;
  const F = { l: 72, r: CARD_W - 72, t: 72, b: 470 }; // frame lines
  const out: string[] = [svgOpen(title, NIGHT.bg)];
  out.push(`<defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${vc}" stop-opacity="0.34"/><stop offset="0.55" stop-color="${vc}" stop-opacity="0.08"/><stop offset="1" stop-color="${vc}" stop-opacity="0"/></radialGradient>
    <linearGradient id="hero" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${vc}"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="bloom" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="18"/></filter>
    ${grainFilter('grain', 'light', 0.05, 0.95)}
  </defs>`);
  out.push(`<ellipse cx="300" cy="300" rx="430" ry="300" fill="url(#glow)"/>`);
  // frame lines and registration marks
  const ln = (d: string) => `<path d="${d}" stroke="${NIGHT.line}" stroke-opacity="0.08" stroke-width="1"/>`;
  out.push(ln(`M0 ${F.t + 0.5}H${CARD_W}M0 ${F.b + 0.5}H${CARD_W}M${F.l + 0.5} 0V${CARD_H}M${F.r + 0.5} 0V${CARD_H}M640.5 ${F.t}V${F.b}`));
  for (const [x, y] of [[F.l, F.t], [F.r, F.t], [F.l, F.b], [F.r, F.b], [640, F.t], [640, F.b]]) out.push(plus(x + 0.5, y + 0.5, 7, NIGHT.text, 0.55));
  // top meta, above the frame
  out.push(text(F.l, 50, 'relaycheck', { size: 18, fill: NIGHT.text, weight: 700, family: mono }));
  out.push(text(F.r, 50, `v${m.version}  ·  ${m.date}`, { size: 15, fill: NIGHT.muted, anchor: 'end', family: mono }));
  // hero
  const word = heroWord(m);
  const isEn = m.lang === 'en';
  let size = isEn ? 120 : [...word].length > 2 ? 150 : 170;
  const maxW = 640 - F.l - 72;
  while (wordWidth(word, size, size * 0.01) > maxW) size -= 2;
  const top = isEn ? 236 : 168;
  const hx = F.l + 40;
  out.push(drawWord(word, hx, top, size, 'hei', vc, size * 0.01, ` filter="url(#bloom)" opacity="0.55"`).replace(/ data-role="verdict"[^>]*data-color="[^"]*"/, ''));
  out.push(drawWord(word, hx, top, size, 'hei', 'url(#hero)', size * 0.01, '', vc));
  const hb = top + wordHeight(word, size);
  out.push(text(hx, hb + 54, fitText(m.secondary, maxW, 20, true, true), { size: 20, fill: vc, weight: 700, family: mono, spacing: m.other === 'en' ? 6 : 3 }));
  // right half: model, decisive number, scale
  const X = 640 + 48;
  const R = F.r - 40;
  out.push(text(X, 132, m.modelLabel, { size: 15, fill: NIGHT.muted, family: mono }));
  out.push(text(X, 172, fitText(m.model, R - X, 28, true, true), { size: 28, fill: NIGHT.text, weight: 700, family: mono }));
  out.push(`<rect x="${X}" y="200" width="${R - X}" height="1" fill="url(#fade)"/>`);
  out.push(text(X, 246, fitText(m.bigLabel, R - X, 15, false, true), { size: 15, fill: NIGHT.muted, family: mono }));
  out.push(slipNumber(X - 2, 318, m, R - X, isEn ? 52 : 60, NIGHT.text, NIGHT.muted));
  if (m.kind === 'p' && m.p !== null) {
    out.push(meter(X, 372, R - X, m.p, { track: '#1f2630', pass: NIGHT.status.pass, warn: NIGHT.status.warn, fail: NIGHT.status.fail, label: NIGHT.faint, marker: '#ffffff' }, { glow: vc, labelSize: 12 }));
  } else if (m.reason) out.push(text(X, 380, fitText(m.reason, R - X, 17), { size: 17, fill: NIGHT.text }));
  // status bar: four cells between frame lines
  const cw = (F.r - F.l) / 4;
  m.chips.forEach((c, i) => {
    const x = F.l + i * cw;
    const sc = NIGHT.status[c.status];
    const loud = c.status === 'fail' || c.status === 'warn';
    if (loud) out.push(`<rect x="${r1(x + 1)}" y="${F.b + 1}" width="${r1(cw - 1)}" height="79" fill="${sc}" fill-opacity="0.09"/><rect x="${r1(x + 1)}" y="${F.b + 1}" width="${r1(cw - 1)}" height="2" fill="${sc}"/>`);
    if (i > 0) out.push(ln(`M${r1(x + 0.5)} ${F.b}V${F.b + 80}`));
    out.push(`<g transform="translate(${r1(x + 24)} ${F.b})"><circle cx="5" cy="40" r="5" fill="${sc}"/>${loud ? `<circle cx="5" cy="40" r="11" fill="${sc}" fill-opacity="0.35" filter="url(#soft)"/>` : ''}${text(22, 47, fitText(c.name, cw - 22 - 24 - 64, 19, true), { size: 19, fill: NIGHT.text, weight: 600 })}${text(cw - 48, 47, c.word, { size: 17, fill: sc, weight: 700, anchor: 'end', family: mono })}</g>`);
  });
  out.push(ln(`M0 ${F.b + 80.5}H${CARD_W}`));
  out.push(text(F.l, 592, fitText(m.host, 360, 14, false, true), { size: 14, fill: NIGHT.faint, family: mono }));
  out.push(text(F.r, 592, REPO, { size: 14, fill: NIGHT.faint, anchor: 'end', family: mono }));
  out.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="#fff" filter="url(#grain)"/>`);
  out.push('</svg>\n');
  return out.join('\n  ');
}

