import { groupName } from '../run.js';
import { formatP } from '../stats.js';
import type { Lang, Report, Status, Verdict } from '../types.js';

export function useColor(env: NodeJS.ProcessEnv, isTTY: boolean, forceOff = false): boolean {
  if (forceOff) return false;
  if ('NO_COLOR' in env && env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  return isTTY;
}

const CODES = { red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90, bold: 1, dim: 2 } as const;
type ColorName = keyof typeof CODES;

export function painter(on: boolean) {
  return (c: ColorName, s: string) => (on ? `\x1b[${CODES[c]}m${s}\x1b[0m` : s);
}

const ICON: Record<Status, string> = { pass: '✔', fail: '✖', warn: '▲', skip: '○', info: 'ℹ' };
const COLOR: Record<Status, ColorName> = { pass: 'green', fail: 'red', warn: 'yellow', skip: 'gray', info: 'blue' };
const VERDICT_COLOR: Record<Verdict, ColorName> = { consistent: 'green', inconsistent: 'red', inconclusive: 'yellow' };

const T = {
  zh: { target: '目标', model: '模型', api: '协议', ref: '参考', none: '无（未校准）', synthetic: '合成', took: '耗时', p: '端点 p 值', used: '本次用量' },
  en: { target: 'target', model: 'model', api: 'api', ref: 'reference', none: 'none (uncalibrated)', synthetic: 'synthetic', took: 'took', p: 'endpoint p-value', used: 'used' },
};

export function renderTerminal(r: Report, lang: Lang, color: boolean): string {
  const c = painter(color);
  const t = T[lang];
  const lines: string[] = [];
  lines.push(c('bold', c(VERDICT_COLOR[r.verdict], r.headline[lang])));
  lines.push(
    c(
      'gray',
      `${t.target}: ${r.target.baseUrl}  ${t.model}: ${r.target.model}  ${t.api}: ${r.target.api}  ${t.ref}: ${
        r.reference ? `${r.reference.model}${r.reference.synthetic ? ` (${t.synthetic})` : ''}` : t.none
      }  ${t.p}: ${formatP(r.pValue)}  ${t.took}: ${(r.durationMs / 1000).toFixed(1)}s${
        r.usage?.requests ? `  ${t.used}: ${r.usage.requests} req, ${r.usage.inputTokens} in / ${r.usage.outputTokens} out tokens` : ''
      }`,
    ),
  );
  for (const g of r.groups) {
    lines.push('');
    lines.push(`${c(COLOR[g.status], ICON[g.status])} ${c('bold', groupName(g.id)[lang].toUpperCase())}  ${c(COLOR[g.status], g.summary[lang])}`);
    for (const res of g.results) {
      lines.push(`   ${c(COLOR[res.status], ICON[res.status])} ${res.title[lang]}: ${res.detail[lang]}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
