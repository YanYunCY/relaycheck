import { maskHost } from '../redact.js';
import { groupName } from '../run.js';
import { formatP } from '../stats.js';
import type { L10n, Lang, Report, Status } from '../types.js';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const COLORS: Record<Status, string> = { pass: '#16a34a', fail: '#dc2626', warn: '#d97706', skip: '#9ca3af', info: '#2563eb' };
const LABEL: Record<Status, L10n> = {
  pass: { zh: '通过', en: 'PASS' },
  fail: { zh: '失败', en: 'FAIL' },
  warn: { zh: '存疑', en: 'WARN' },
  skip: { zh: '跳过', en: 'SKIP' },
  info: { zh: '信息', en: 'INFO' },
};

const bi = (x: L10n) => `<span lang="zh">${esc(x.zh)}</span><span lang="en">${esc(x.en)}</span>`;

/** Self-contained HTML report with a zh/en toggle. Host is hidden unless showHost. */
export function renderHtml(r: Report, lang: Lang, showHost: boolean): string {
  const target = showHost ? r.target.baseUrl : maskHost(r.target.baseUrl);
  const groups = r.groups
    .map(
      (g) => `<section><h2><span class="badge" style="background:${COLORS[g.status]}">${bi(LABEL[g.status])}</span> ${bi(groupName(g.id))} <small>${bi(g.summary)}</small></h2>
<table>${g.results
        .map(
          (x) => `<tr><td><span class="dot" style="background:${COLORS[x.status]}"></span>${bi(LABEL[x.status])}</td><td><b>${bi(x.title)}</b><br>${bi(x.detail)}${
            x.evidence ? `<details><summary>evidence</summary><pre>${esc(JSON.stringify(x.evidence, null, 2))}</pre></details>` : ''
          }</td></tr>`,
        )
        .join('\n')}</table></section>`,
    )
    .join('\n');
  const vcolor = r.verdict === 'consistent' ? COLORS.pass : r.verdict === 'inconsistent' ? COLORS.fail : COLORS.warn;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>relaycheck report · ${esc(r.target.model)}</title>
<style>
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#111;background:#fafafa}
h1{font-size:1.5rem;margin:.2rem 0}.verdict{border-left:6px solid ${vcolor};background:#fff;padding:1rem 1.2rem;border-radius:8px;box-shadow:0 1px 3px #0001}
.meta{color:#555;font-size:.9rem}section{background:#fff;border-radius:8px;margin:1rem 0;padding:.6rem 1rem;box-shadow:0 1px 3px #0001}
h2{font-size:1.1rem}h2 small{color:#555;font-weight:400;margin-left:.4rem}table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:.45rem .3rem;border-top:1px solid #eee}
td:first-child{width:6.5rem;white-space:nowrap}.badge{color:#fff;border-radius:4px;padding:.1rem .45rem;font-size:.8rem}.dot{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;margin-right:.35rem}
pre{background:#f4f4f5;padding:.6rem;overflow:auto;font-size:.78rem;max-height:320px}button{border:1px solid #ccc;background:#fff;border-radius:4px;padding:.2rem .6rem;cursor:pointer}
body.zh [lang=en]{display:none}body.en [lang=zh]{display:none}footer{color:#777;font-size:.8rem;margin:2rem 0}
</style></head>
<body class="${lang}">
<div style="float:right"><button onclick="document.body.className='zh'">中文</button> <button onclick="document.body.className='en'">English</button></div>
<div class="meta">relaycheck v${esc(r.version)} · ${esc(r.startedAt)}</div>
<div class="verdict"><h1 style="color:${vcolor}">${bi(r.headline)}</h1>
<div class="meta">${bi({ zh: '目标', en: 'target' })}: ${esc(target)} · ${bi({ zh: '模型', en: 'model' })}: <b>${esc(r.target.model)}</b> · API: ${esc(r.target.api)} · p=${esc(formatP(r.pValue))} · ${bi({ zh: '参考', en: 'reference' })}: ${
    r.reference ? esc(r.reference.model) + (r.reference.synthetic ? ' (synthetic)' : '') : bi({ zh: '无（未校准）', en: 'none (uncalibrated)' })
  }</div></div>
${groups}
<footer>${bi({ zh: 'key 从未离开本机；报告已脱敏。统计结论是概率判断，不是定罪。', en: 'Your key never left this machine; this report is redacted. Statistical verdicts are evidence, not proof.' })}</footer>
</body></html>
`;
}
