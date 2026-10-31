import { hostOf } from '../redact.js';
import { groupName } from '../run.js';
import { formatP } from '../stats.js';
import type { GroupId, Report, Status } from '../types.js';
import { esc } from './html.js';

const COLORS: Record<Status, string> = { pass: '#22c55e', fail: '#ef4444', warn: '#f59e0b', skip: '#6b7280', info: '#3b82f6' };
const LABEL: Record<Status, string> = { pass: '通过 PASS', fail: '失败 FAIL', warn: '存疑 WARN', skip: '跳过 SKIP', info: '信息 INFO' };
const VERDICT = {
  consistent: { zh: '一致', en: 'CONSISTENT', color: '#22c55e' },
  inconsistent: { zh: '不一致', en: 'INCONSISTENT', color: '#ef4444' },
  inconclusive: { zh: '存疑', en: 'INCONCLUSIVE', color: '#f59e0b' },
};

function localDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Font stack: Latin UI fonts first, then CJK fonts for every platform, so Chinese never falls back to tofu. */
export const CARD_FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', Roboto, 'Helvetica Neue', Arial, sans-serif";

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

/** Conservative width estimate (in em) of one character in a proportional sans font. */
function charEm(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (isWide(cp)) return 1;
  if (ch === ' ') return 0.3;
  if (/[iljI.,:;'|!·]/.test(ch)) return 0.3;
  if (/[MW@%]/.test(ch)) return 0.9;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.58;
  return 0.56;
}

/** Estimated rendered width in px; errs on the wide side so text never overruns its box. */
export function textWidth(s: string, fontSize: number, bold = false): number {
  let em = 0;
  for (const ch of s) em += charEm(ch);
  return em * fontSize * (bold ? 1.06 : 1);
}

/** Clip to an estimated pixel width, adding an ellipsis when cut. */
export function fitText(s: string, maxPx: number, fontSize: number, bold = false): string {
  if (textWidth(s, fontSize, bold) <= maxPx) return s;
  const limit = maxPx - textWidth('…', fontSize, bold);
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charEm(ch) * fontSize * (bold ? 1.06 : 1);
    if (w + cw > limit) break;
    out += ch;
    w += cw;
  }
  return out.trimEnd() + '…';
}

/** 1200×630 bilingual SVG report card for sharing. Host is hidden unless showHost. */
export function renderCard(r: Report, showHost = false): string {
  const W = 1072; // usable text width: x 64 → 1136
  const v = VERDICT[r.verdict];
  const host = showHost ? hostOf(r.target.baseUrl) : '主机已隐藏 host hidden';
  const font = `font-family="${CARD_FONT_STACK}"`;
  const ids: GroupId[] = ['identity', 'protocol', 'billing', 'context'];
  const rows = ids
    .map((id, i) => {
      const g = r.groups.find((x) => x.id === id);
      const st: Status = g?.status ?? 'skip';
      const y = 318 + i * 62;
      const name = groupName(id);
      // the summary column runs from x=330 to the right-aligned status label (≈ x 900)
      const sum = g ? fitText(`${g.summary.zh} · ${g.summary.en}`, 580, 20) : '未运行 · not run';
      return `<g transform="translate(64 ${y})">
  <rect width="1072" height="50" rx="10" fill="#111827"/>
  <circle cx="26" cy="25" r="9" fill="${COLORS[st]}"/>
  <text x="50" y="32" font-size="22" fill="#f9fafb" font-weight="600">${esc(name.zh)} ${esc(name.en[0].toUpperCase() + name.en.slice(1))}</text>
  <text x="330" y="32" font-size="20" fill="#d1d5db">${esc(sum)}</text>
  <text x="1052" y="32" font-size="20" fill="${COLORS[st]}" font-weight="700" text-anchor="end">${LABEL[st]}</text>
</g>`;
    })
    .join('\n');
  const facts = [
    `p = ${formatP(r.pValue)}${r.calibrated ? '' : ' (未校准 uncalibrated)'}`,
    r.injectedTokens ? `+${r.injectedTokens} tok/req` : null,
    r.reference?.synthetic ? 'synthetic ref 合成参考' : null,
  ]
    .filter(Boolean)
    .join('   ·   ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" ${font}>
  <title>relaycheck: ${esc(v.zh)} ${esc(v.en)} · ${esc(r.target.model)}</title>
  <rect width="1200" height="630" fill="#030712"/>
  <rect x="0" y="0" width="12" height="630" fill="${v.color}"/>
  <text x="64" y="76" font-size="28" fill="#9ca3af" font-weight="600">relaycheck 验货报告 · Relay Check Report</text>
  <text x="64" y="160" font-size="76" fill="${v.color}" font-weight="800">${esc(v.zh)} ${esc(v.en)}</text>
  <text x="64" y="212" font-size="26" fill="#f9fafb">${esc(fitText(`${fitText(r.target.model, 520, 26)}  ·  ${r.target.api}  ·  ${host}`, W, 26))}</text>
  <text x="64" y="256" font-size="24" fill="#d1d5db">${esc(fitText(facts, W, 24))}</text>
  <text x="64" y="292" font-size="19" fill="#9ca3af">${esc(fitText(r.headline.zh, W, 19))}</text>
${rows}
  <text x="64" y="604" font-size="18" fill="#9ca3af">npx relaycheck · ${esc(localDate(r.startedAt))} · key 未离开本机 key never left the machine</text>
</svg>
`;
}
