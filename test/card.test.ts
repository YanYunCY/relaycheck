import { describe, expect, it } from 'vitest';
import {
  CARD_FONT_STACK,
  CARD_MONO_STACK,
  CARD_STYLES,
  DEFAULT_CARD_STYLE,
  cardStyleOf,
  fitSize,
  fitText,
  renderCard,
  textWidth,
  type CardStyle,
} from '../src/report/card.js';
import type { Lang, Report } from '../src/types.js';

function report(over: Partial<Report> = {}): Report {
  const g = (id: 'identity' | 'protocol' | 'billing' | 'context', zh: string, en: string, status: 'pass' | 'fail' = 'pass') => ({
    id,
    status,
    summary: { zh, en },
    results: [],
  });
  return {
    tool: 'relaycheck',
    version: '0.0.0',
    target: { baseUrl: 'https://relay.example.com/v1', host: 'relay.example.com', model: 'claude-sonnet-4-5', api: 'anthropic' },
    startedAt: 'Sat 2026-10-31 8:00 AM CST (UTC+08:00)',
    durationMs: 1000,
    verdict: 'inconsistent',
    exitCode: 1,
    headline: { zh: '不一致：每请求多计 512 input token', en: 'INCONSISTENT: +512 hidden input tokens per request' },
    pValue: 0.0003,
    calibrated: true,
    injectedTokens: 512,
    reference: null,
    usage: { requests: 1, inputTokens: 1, outputTokens: 1 },
    groups: [
      g('identity', '身份一致', 'identity consistent'),
      g('protocol', '协议保真', 'protocol intact'),
      g('billing', '每请求多计 512 input token', '+512 hidden input tokens per request', 'fail'),
      g('context', '上下文完整', 'context intact'),
    ],
    ...over,
  };
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

interface Box {
  text: string;
  size: number;
  left: number;
  right: number;
  /** id of the enclosing translated <g> (chips), or -1 */
  group: number;
}

/**
 * Walk the SVG and return the estimated horizontal extent of every <text>, in card coordinates.
 * Widths use the same conservative estimator as the renderer, honouring each run's weight and font family.
 */
function boxes(svg: string): Box[] {
  const out: Box[] = [];
  const stack: { dx: number; id: number; mono: boolean }[] = [];
  let gid = 0;
  const re = /<g\b[^>]*>|<\/g>|<text\b[^>]*>[\s\S]*?<\/text>/g;
  for (const m of svg.matchAll(re)) {
    const tag = m[0];
    if (tag === '</g>') {
      stack.pop();
      continue;
    }
    if (tag.startsWith('<g') && attr(tag, 'data-role') === 'verdict') {
      // a word drawn from glyph outlines: its em size and unrotated extent are on the group
      const left = Number(attr(tag, 'data-x')) + stack.reduce((a, g) => a + g.dx, 0);
      out.push({ text: unesc(attr(tag, 'data-word')!), size: Number(attr(tag, 'data-size')), left, right: left + Number(attr(tag, 'data-w')), group: -1 });
      stack.push({ dx: 0, id: -1, mono: false });
      continue;
    }
    if (tag.startsWith('<g')) {
      const t = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(attr(tag, 'transform') ?? '');
      stack.push({ dx: t ? Number(t[1]) : 0, id: t ? ++gid : -1, mono: (attr(tag, 'font-family') ?? '').startsWith("'JetBrains Mono'") });
      continue;
    }
    const open = /^<text\b[^>]*>/.exec(tag)![0];
    const size = Number(attr(open, 'font-size'));
    const spacing = Number(attr(open, 'letter-spacing') ?? 0);
    const fam = attr(open, 'font-family');
    const mono = fam ? fam.startsWith("'JetBrains Mono'") : stack.some((g) => g.mono);
    const bold = Number(attr(open, 'font-weight') ?? 400) >= 600;
    // segments: text outside tspans uses the text's size; each tspan may set its own size and dx
    let width = 0;
    let plain = '';
    const body = tag.slice(open.length, -'</text>'.length);
    for (const seg of body.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>|([^<]+)/g)) {
      const s = unesc(seg[2] ?? seg[3] ?? '');
      const fs = seg[1] ? Number(attr(` ${seg[1]}`, 'font-size') ?? size) : size;
      const segMono = seg[1] && attr(` ${seg[1]}`, 'font-family') ? false : mono;
      const segBold = seg[1] && attr(` ${seg[1]}`, 'font-weight') ? Number(attr(` ${seg[1]}`, 'font-weight')) >= 600 : bold;
      const dx = seg[1] ? Number(attr(` ${seg[1]}`, 'dx') ?? 0) : 0;
      width += dx + textWidth(s, fs, segBold, segMono) + spacing * [...s].length;
      plain += s;
    }
    const x = Number(attr(open, 'x')) + stack.reduce((a, g) => a + g.dx, 0);
    const anchor = attr(open, 'text-anchor') ?? 'start';
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    const chip = [...stack].reverse().find((g) => g.id > 0);
    out.push({ text: plain, size, left, right: left + width, group: chip?.id ?? -1 });
  }
  return out;
}

const longReport = () =>
  report({
    target: { baseUrl: 'https://relay.example.com/v1', host: 'relay.example.com', model: 'claude-sonnet-4-5-20250929-thinking-extended-preview-'.repeat(3), api: 'anthropic' },
    headline: { zh: '不一致：'.padEnd(120, '模'), en: 'x'.repeat(200) },
    injectedTokens: null,
    groups: report().groups.map((g, i) => ({
      ...g,
      status: i === 0 ? 'fail' : g.status,
      summary: { zh: '上下文在约二千到三万二千 token 之间被截断'.repeat(3), en: 'context truncated somewhere between 2k and 32k tokens '.repeat(3) },
    })),
  });

const combos: [CardStyle, Lang][] = CARD_STYLES.flatMap((s) => (['zh', 'en'] as Lang[]).map((l) => [s, l] as [CardStyle, Lang]));

describe('share card', () => {
  it('measures CJK as full width and Latin narrower', () => {
    expect(textWidth('一致', 20)).toBe(40);
    expect(textWidth('ab', 20)).toBeLessThan(textWidth('一致', 20));
    expect(textWidth('abc', 10, false, true)).toBeCloseTo(18);
    expect(textWidth('ab', 10, false, false, 2)).toBeCloseTo(textWidth('ab', 10) + 4);
  });

  it('fitText clips by width (CJK-aware) and adds an ellipsis', () => {
    expect(fitText('short', 500, 20)).toBe('short');
    const cjk = '中'.repeat(60); // 1200px at 20px
    const out = fitText(cjk, 600, 20);
    expect(out.endsWith('…')).toBe(true);
    expect(textWidth(out, 20)).toBeLessThanOrEqual(600);
    expect([...out].length).toBeLessThan(31);
    // the old character-count clip let 44 CJK chars (≈880px) through; width-aware keeps it inside
    expect(textWidth(fitText('计'.repeat(44), 600, 20), 20)).toBeLessThanOrEqual(600);
  });

  it('fitSize picks the largest size that fits, capped', () => {
    expect(fitSize('一致', 1000, 176)).toBe(176);
    const s = fitSize('INCONSISTENT', 1056, 176);
    expect(s).toBeLessThan(176);
    expect(textWidth('INCONSISTENT', s, true)).toBeLessThanOrEqual(1056);
  });

  it('declares a font stack with CJK fallbacks for every platform', () => {
    for (const style of CARD_STYLES) {
      const svg = renderCard(report(), { style });
      expect(svg).toContain(`font-family="${CARD_FONT_STACK}"`);
      expect(svg).toContain('<title>');
      expect(svg).toMatch(/^<\?xml[^>]*\?>\s*<svg [^>]*width="1200" height="630"/);
    }
    for (const stack of [CARD_FONT_STACK, CARD_MONO_STACK])
      for (const f of ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC']) expect(stack).toContain(f);
    expect(CARD_FONT_STACK).toMatch(/sans-serif$/);
  });

  it.each(combos)('%s/%s: every line stays inside the card even with very long, CJK-heavy content', (style, lang) => {
    const svg = renderCard(longReport(), { style, lang });
    const bs = boxes(svg);
    expect(bs.length).toBeGreaterThan(10);
    for (const b of bs) {
      expect(b.left, b.text).toBeGreaterThanOrEqual(60);
      expect(b.right, b.text).toBeLessThanOrEqual(1140);
    }
    if (style === 'stamp') {
      // texts in the verdict block stay inside it, with a margin
      const P = Number(/<rect width="(?!1200")(\d+)" height="630" fill=/.exec(svg)![1]);
      for (const b of bs) if (b.left < P) expect(b.right, b.text).toBeLessThanOrEqual(P - 24);
    }
    // in every chip the group name ends before the status word starts
    const chips = new Map<number, Box[]>();
    for (const b of bs) if (b.group > 0) chips.set(b.group, [...(chips.get(b.group) ?? []), b]);
    if (style === 'slip') {
      // paper-form checkboxes: name only, each inside its quarter of the main column
      const names = [...chips.values()].filter((c) => c.length === 1).map((c) => c[0]).filter((b) => b.size === 19);
      expect(names.length).toBe(4);
      names.sort((a, b) => a.left - b.left);
      for (let i = 1; i < names.length; i++) expect(names[i - 1].right, names[i - 1].text).toBeLessThanOrEqual(names[i].left - 30);
    } else {
      const rows = [...chips.values()].filter((c) => c.length === 2);
      expect(rows.length).toBeGreaterThanOrEqual(4);
      for (const [name, word] of rows) expect(name.right, name.text).toBeLessThanOrEqual(word.left);
    }
  });

  it('the verdict is the dominant element: ≥ 2× any other text, and larger than the decisive number', () => {
    for (const [style, lang] of combos) {
      const bs = boxes(renderCard(report(), { style, lang }));
      const verdict = bs.find((b) => b.text === (lang === 'zh' ? '不一致' : 'INCONSISTENT'))!;
      expect(verdict, `${style}/${lang}`).toBeTruthy();
      for (const b of bs) {
        if (b === verdict) continue;
        const decisive = /^(p =)?[+]?\d/.test(b.text);
        expect(verdict.size, `${style}/${lang}: ${b.text}`).toBeGreaterThanOrEqual((decisive ? 1.1 : 2) * b.size);
      }
    }
  });

  it('hides the host by default and shows it on request', () => {
    for (const style of CARD_STYLES) {
      expect(renderCard(report(), { style })).not.toContain('relay.example.com');
      expect(renderCard(report(), { style })).toContain('主机已隐藏');
      expect(renderCard(report(), { style, lang: 'en' })).toContain('host hidden');
      expect(renderCard(report(), { style, showHost: true })).toContain('relay.example.com');
    }
    // legacy signature renderCard(report, showHost)
    expect(renderCard(report(), true)).toContain('relay.example.com');
  });

  it('shows the verdict in both languages, primary by lang', () => {
    const zh = renderCard(report(), { lang: 'zh' });
    expect(zh).toContain('不一致 INCONSISTENT'); // title
    const en = boxes(renderCard(report(), { lang: 'en' }));
    const big = (bs: Box[], t: string) => bs.find((b) => b.text === t)!.size;
    expect(big(en, 'INCONSISTENT')).toBeGreaterThan(big(en, '不一致') * 2);
    const z = boxes(zh);
    expect(big(z, '不一致')).toBeGreaterThan(big(z, 'INCONSISTENT') * 2);
  });

  it('picks the decisive number: hidden tokens, else identity p-value, else groups passed', () => {
    const inj = renderCard(report());
    expect(inj).toContain('+512');
    expect(inj).toContain('tokens/请求');
    expect(renderCard(report(), { lang: 'en' })).toContain('tokens/req');

    const swap = report({ injectedTokens: null, pValue: 8.3e-6, groups: report().groups.map((g) => ({ ...g, status: g.id === 'identity' ? 'fail' : 'pass' })) });
    const s = renderCard(swap);
    expect(s).toContain('8.3e-6');
    expect(s).toContain('身份检验 p 值');

    const trunc = report({ injectedTokens: null, groups: report().groups.map((g) => ({ ...g, status: g.id === 'context' ? 'fail' : 'pass' })) });
    expect(renderCard(trunc)).toContain('3/4');
  });

  it('renders all three verdicts with distinct colours in each style', () => {
    for (const style of CARD_STYLES) {
      const fills = (['consistent', 'inconsistent', 'inconclusive'] as const).map((verdict) => {
        const svg = renderCard(report({ verdict }), { style });
        const word = verdict === 'consistent' ? '一致' : verdict === 'inconsistent' ? '不一致' : '存疑';
        const m =
          style === 'stamp'
            ? /<rect width="(?!1200")\d+" height="630" fill="(#[0-9a-f]{6})"/.exec(svg)
            : style === 'ink'
              ? new RegExp(`fill="(#[0-9a-f]{6})"[^>]*>${word}</text>`).exec(svg)
              : new RegExp(`data-role="verdict" data-word="${word}"[^>]*data-color="(#[0-9a-f]{6})"`).exec(svg);
        return m?.[1];
      });
      expect(new Set(fills).size, style).toBe(3);
    }
  });

  it('draws the verdict from embedded outlines in the round-2 styles (no font dependency)', () => {
    for (const style of ['slip', 'lab', 'night'] as CardStyle[])
      for (const lang of ['zh', 'en'] as Lang[]) {
        const svg = renderCard(report(), { style, lang });
        const g = new RegExp(`<g [^>]*data-role="verdict" data-word="${lang === 'zh' ? '不一致' : 'INCONSISTENT'}"[^>]*>(.*?)</g>`).exec(svg);
        expect(g, `${style}/${lang}`).toBeTruthy();
        expect(g![1]).toMatch(/^(<path [^>]*d="M[^"]+"\/>)+$/);
        expect(svg).not.toMatch(/<image|href="http|@import|url\(http/);
      }
    expect(DEFAULT_CARD_STYLE).toBe('slip');
  });

  it('round-2 styles render every verdict and decisive-number kind', () => {
    const swap = report({ injectedTokens: null, pValue: 8.3e-6, groups: report().groups.map((g) => ({ ...g, status: g.id === 'identity' ? 'fail' : 'pass' })) });
    for (const style of ['slip', 'lab', 'night'] as CardStyle[]) {
      expect(renderCard(swap, { style })).toContain('data-role="meter"');
      expect(renderCard(report(), { style })).toContain('+512');
      for (const verdict of ['consistent', 'inconsistent', 'inconclusive'] as const) {
        const svg = renderCard(report({ verdict }), { style, lang: 'en' });
        expect(svg).toMatch(/<\/svg>\s*$/);
        expect(svg).not.toContain('NaN');
        expect(svg).not.toContain('undefined');
      }
    }
  });

  it('escapes user content and accepts an internal style switch', () => {
    const svg = renderCard(report({ target: { ...report().target, model: '<script>&"x' } }));
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(cardStyleOf('ink')).toBe('ink');
    expect(cardStyleOf('B')).toBe('stamp');
    for (const s of ['slip', 'lab', 'night'] as const) expect(cardStyleOf(s.toUpperCase())).toBe(s);
    expect(cardStyleOf(undefined)).toBe(DEFAULT_CARD_STYLE);
    expect(cardStyleOf('neon')).toBe(DEFAULT_CARD_STYLE);
  });
});
