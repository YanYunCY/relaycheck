import { describe, expect, it } from 'vitest';
import { CARD_FONT_STACK, fitText, renderCard, textWidth } from '../src/report/card.js';
import type { Report } from '../src/types.js';

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
    startedAt: '2026-10-31T00:00:00.000Z',
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

const texts = (svg: string) => [...svg.matchAll(/<text[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ size: Number(m[1]), text: m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') }));

describe('share card', () => {
  it('measures CJK as full width and Latin narrower', () => {
    expect(textWidth('一致', 20)).toBe(40);
    expect(textWidth('ab', 20)).toBeLessThan(textWidth('一致', 20));
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

  it('declares a font stack with CJK fallbacks for every platform', () => {
    const svg = renderCard(report());
    expect(svg).toContain(`font-family="${CARD_FONT_STACK}"`);
    for (const f of ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'sans-serif']) expect(CARD_FONT_STACK).toContain(f);
    expect(svg).toContain('<title>');
  });

  it('keeps every line inside the card even with very long, CJK-heavy content', () => {
    const long = report({
      target: { baseUrl: 'https://relay.example.com/v1', host: 'relay.example.com', model: 'claude-sonnet-4-5-20250929-thinking-extended-preview-'.repeat(3), api: 'anthropic' },
      headline: { zh: '不一致：'.padEnd(120, '模'), en: 'x' },
      groups: report().groups.map((g) => ({ ...g, summary: { zh: '上下文在约二千到三万二千 token 之间被截断'.repeat(3), en: 'context truncated somewhere between 2k and 32k tokens' } })),
    });
    const svg = renderCard(long);
    for (const t of texts(svg)) {
      if (t.size >= 70) continue; // verdict title: fixed short strings
      expect(textWidth(t.text, t.size), t.text).toBeLessThanOrEqual(1072);
    }
    // group summaries must stay clear of the right-aligned status label
    const sums = texts(svg).filter((t) => t.size === 20 && t.text.includes('截断'));
    expect(sums).toHaveLength(4);
    for (const s of sums) expect(textWidth(s.text, 20)).toBeLessThanOrEqual(580);
  });

  it('hides the host by default and shows it on request', () => {
    expect(renderCard(report())).not.toContain('relay.example.com');
    expect(renderCard(report())).toContain('host hidden');
    expect(renderCard(report(), true)).toContain('relay.example.com');
  });

  it('shows the hidden-token fact and verdict', () => {
    const svg = renderCard(report());
    expect(svg).toContain('不一致 INCONSISTENT');
    expect(svg).toContain('+512 tok/req');
  });
});
