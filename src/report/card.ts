import { hostOf, maskHost } from '../redact.js';
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

function clip(s: string, n: number): string {
  const arr = [...s];
  return arr.length > n ? arr.slice(0, n - 1).join('') + '…' : s;
}

/** 1200×630 bilingual SVG report card for sharing. Host is hidden unless showHost. */
export function renderCard(r: Report, showHost = false): string {
  const v = VERDICT[r.verdict];
  const host = showHost ? hostOf(r.target.baseUrl) : maskHost(r.target.baseUrl).replace(/^https?:\/\//, '') + '  (主机已隐藏 host hidden)';
  const font = `font-family="-apple-system, 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif"`;
  const ids: GroupId[] = ['identity', 'protocol', 'billing', 'context'];
  const rows = ids
    .map((id, i) => {
      const g = r.groups.find((x) => x.id === id);
      const st: Status = g?.status ?? 'skip';
      const y = 318 + i * 62;
      const name = groupName(id);
      const sum = g ? clip(`${g.summary.zh} · ${g.summary.en}`, 44) : '未运行 · not run';
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
  <rect width="1200" height="630" fill="#030712"/>
  <rect x="0" y="0" width="12" height="630" fill="${v.color}"/>
  <text x="64" y="76" font-size="28" fill="#9ca3af" font-weight="600">relaycheck 验货报告 · Relay Check Report</text>
  <text x="64" y="160" font-size="76" fill="${v.color}" font-weight="800">${esc(v.zh)} ${esc(v.en)}</text>
  <text x="64" y="212" font-size="26" fill="#f9fafb">${esc(clip(r.target.model, 40))}  ·  ${esc(r.target.api)}  ·  ${esc(clip(host, 48))}</text>
  <text x="64" y="256" font-size="24" fill="#d1d5db">${esc(clip(facts, 80))}</text>
  <text x="64" y="292" font-size="19" fill="#9ca3af">${esc(clip(r.headline.zh, 64))}</text>
${rows}
  <text x="64" y="604" font-size="18" fill="#6b7280">npx relaycheck · ${esc(localDate(r.startedAt))} · key 未离开本机 key never left the machine</text>
</svg>
`;
}
