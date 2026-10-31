// Pass-through proxy to api.openai.com that meters usage into calib/spend.jsonl and hard-stops at a budget.
//   NODE_USE_ENV_PROXY=1 node scripts/meter-proxy.mjs --port 18980 --tag fp-v2 --budget 5
import { createServer } from 'node:http';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '18980')), tag = opt('tag', 'meter'), budget = Number(opt('budget', '5'));
const swapTo = opt('swap-to', '');
const PRICES = { 'gpt-6-luna': [0.1, 0.5], 'gpt-6.1-terra': [1, 5], 'gpt-6.1-sol': [2, 10], 'gpt-5.3-codex': [1.75, 14], 'gpt-5.6-luna': [0.2, 1.2], 'gpt-6-astra': [10, 50] };
const FILE = 'calib/spend.jsonl';
let spent = existsSync(FILE) ? readFileSync(FILE, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + JSON.parse(l).usd, 0) : 0;
let pend = { usd: 0, input: 0, output: 0, requests: 0 };
const flush = () => { if (pend.requests) { appendFileSync(FILE, JSON.stringify({ tag, at: new Date().toISOString(), ...pend }) + '\n'); pend = { usd: 0, input: 0, output: 0, requests: 0 }; } };
setInterval(flush, 5000).unref();
process.on('SIGTERM', () => { flush(); process.exit(0); });
createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  let b = {}; try { b = body ? JSON.parse(body) : {}; } catch {}
  const claimed = b.model; if (swapTo && b.model) b.model = swapTo;
  const model = b.model;
  if (spent > budget) { res.writeHead(402, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"BUDGET STOP"}}'); }
  const up = await fetch('https://api.openai.com' + req.url, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization ?? '' }, body: req.method === 'POST' ? JSON.stringify(b) : undefined }).catch(e => null);
  if (!up) { res.writeHead(502); return res.end('{"error":{"message":"upstream"}}'); }
  let text = await up.text();
  const p = PRICES[model];
  // usage may be in a JSON body or in the final SSE event
  const m = [...text.matchAll(/"input_tokens":\s*(\d+)[\s\S]*?"output_tokens":\s*(\d+)/g)].pop() || [...text.matchAll(/"prompt_tokens":\s*(\d+)[\s\S]*?"completion_tokens":\s*(\d+)/g)].pop();
  if (m && p) { const i = +m[1], o = +m[2]; pend.input += i; pend.output += o; pend.requests++; const c = (i * p[0] + o * p[1]) / 1e6; pend.usd += c; spent += c; }
  if (swapTo && claimed) text = text.split(`"model":"${swapTo}`).join(`"model":"${claimed}`);
  res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' });
  res.end(text);
}).listen(port, () => console.log(`meter proxy :${port} tag=${tag} budget=$${budget} spent=$${spent.toFixed(4)}`));
