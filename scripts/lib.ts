/**
 * Shared helpers for REAL-API experiment scripts (not part of `npm test`).
 * Every request goes through a metered adapter that appends usage to calib/spend.jsonl.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createAdapter } from '../src/api/detect.js';
import type { Adapter, ApiKind, ChatRequest } from '../src/api/types.js';

export const PRICES: Record<string, [number, number]> = {
  // USD per 1M tokens [input, output]
  'gpt-6-luna': [0.1, 0.5],
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5-nano': [0.05, 0.4],
  'gpt-5.4-nano': [0.2, 1.25], // price not given in the brief: conservative assumption
};
export const MODEL_CFG: Record<string, { api: ApiKind; effort: string }> = {
  'gpt-6-luna': { api: 'responses', effort: 'none' },
  'gpt-5.6-luna': { api: 'responses', effort: 'none' },
  'gpt-5-nano': { api: 'responses', effort: 'minimal' },
  'gpt-5.4-nano': { api: 'responses', effort: 'none' },
};
export const SPEND_FILE = 'calib/spend.jsonl';
export const BUDGET_USD = 0.45; // hard stop a little under the $0.50 ceiling

export function spendSoFar(): { usd: number; input: number; output: number; requests: number } {
  if (!existsSync(SPEND_FILE)) return { usd: 0, input: 0, output: 0, requests: 0 };
  let usd = 0, input = 0, output = 0, requests = 0;
  for (const line of readFileSync(SPEND_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    usd += r.usd; input += r.input; output += r.output; requests += r.requests;
  }
  return { usd, input, output, requests };
}

let pending = { usd: 0, input: 0, output: 0, requests: 0 };
let base = spendSoFar();
export function flushSpend(tag: string) {
  mkdirSync('calib', { recursive: true });
  if (pending.requests) appendFileSync(SPEND_FILE, JSON.stringify({ tag, at: new Date().toISOString(), ...pending }) + '\n');
  base = spendSoFar();
  pending = { usd: 0, input: 0, output: 0, requests: 0 };
}
export function currentSpend() {
  return base.usd + pending.usd;
}

export function meteredAdapter(model: string, tag: string): Adapter {
  const cfg = MODEL_CFG[model];
  const price = PRICES[model];
  if (!cfg || !price) throw new Error(`model ${model} not allowed in experiments`);
  const key = process.env.RELAY_KEY ?? '';
  const a = createAdapter(cfg.api, { baseUrl: 'https://api.openai.com/v1', key, timeoutMs: 60000, retries: 4, reasoningEffort: cfg.effort });
  const orig = a.chat.bind(a);
  let n = 0;
  a.chat = async (req: ChatRequest) => {
    if (currentSpend() > BUDGET_USD) throw new Error(`BUDGET STOP: spend ${currentSpend().toFixed(4)} > ${BUDGET_USD}`);
    const r = await orig(req);
    const i = r.usage.input ?? 0, o = r.usage.output ?? 0;
    pending.input += i; pending.output += o; pending.requests++;
    pending.usd += (i * price[0] + o * price[1]) / 1e6;
    if (++n % 10 === 0) flushSpend(tag);
    return r;
  };
  return a;
}
