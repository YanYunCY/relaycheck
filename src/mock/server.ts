/**
 * A fake LLM relay for demos and tests. Speaks enough of the Anthropic Messages,
 * OpenAI Chat Completions and OpenAI Responses protocols (incl. SSE streaming,
 * tool calls, thinking, prompt caching, count_tokens) for every relaycheck probe.
 *
 * kinds:
 *   honest   – answers from the built-in "requested model" distribution
 *   swap     – answers from a different model's distribution (and self-reports as it)
 *   inject   – honest answers, but usage reports N extra input tokens (hidden prompt)
 *   truncate – silently drops everything after the first 8k prompt tokens
 */
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CUTOFF_PROMPT, SELF_REPORT_PROMPT } from '../probes/identity.js';
import { PROBE_SETS } from '../probes/probesets.js';
import { hash32, mulberry32 } from '../rng.js';
import { estimatePromptTokens, estimateTokens } from '../tokens.js';
import { displayLabel, personaWeights } from './distributions.js';

export type MockKind = 'honest' | 'swap' | 'inject' | 'truncate';
export const MOCK_KINDS: MockKind[] = ['honest', 'swap', 'inject', 'truncate'];

export interface MockOptions {
  kind: MockKind;
  port?: number;
  host?: string;
  seed?: number;
  injectTokens?: number;
  truncateTokens?: number;
  swapModelName?: string;
}

export interface MockHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

interface NMsg {
  role: 'user' | 'assistant';
  text: string;
  toolResults: string[];
}

interface NReq {
  protocol: 'anthropic' | 'openai' | 'responses';
  model: string;
  system: string;
  systemCacheable: boolean;
  messages: NMsg[];
  tools: { name: string; params: any }[];
  forceTool: boolean;
  maxTokens: number;
  stop: string[];
  thinking: boolean;
  stream: boolean;
}

interface Gen {
  thinking?: { text: string; signature: string };
  text: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  stop: 'end' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stopSeq?: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const ESSAY_WORDS =
  'Bridges began as fallen logs and rope spans, then Roman engineers perfected the stone arch, medieval builders added towns on their decks, and the industrial age brought iron, steel and suspension cables that let roads leap across wide rivers and deep valleys. '.repeat(12);

function partText(c: any): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
  return '';
}

function normalizeAnthropic(b: any): NReq {
  let system = '';
  let cacheable = false;
  if (typeof b.system === 'string') system = b.system;
  else if (Array.isArray(b.system)) {
    system = b.system.map((x: any) => x?.text ?? '').join('\n');
    cacheable = b.system.some((x: any) => x?.cache_control);
  }
  const messages: NMsg[] = (b.messages ?? []).map((m: any) => {
    if (typeof m.content === 'string') return { role: m.role, text: m.content, toolResults: [] };
    const blocks: any[] = Array.isArray(m.content) ? m.content : [];
    if (blocks.some((x) => x?.cache_control)) cacheable = true;
    return {
      role: m.role,
      text: blocks.filter((x) => x?.type === 'text').map((x) => x.text).join('\n'),
      toolResults: blocks.filter((x) => x?.type === 'tool_result').map((x) => partText(x.content)),
    };
  });
  return {
    protocol: 'anthropic',
    model: b.model,
    system,
    systemCacheable: cacheable,
    messages,
    tools: (b.tools ?? []).map((t: any) => ({ name: t.name, params: t.input_schema })),
    forceTool: b.tool_choice?.type === 'tool' || b.tool_choice?.type === 'any',
    maxTokens: b.max_tokens ?? 1024,
    stop: b.stop_sequences ?? [],
    thinking: b.thinking?.type === 'enabled',
    stream: !!b.stream,
  };
}

function normalizeOpenAI(b: any): NReq {
  const sys: string[] = [];
  const messages: NMsg[] = [];
  for (const m of b.messages ?? []) {
    if (m.role === 'system' || m.role === 'developer') sys.push(partText(m.content));
    else if (m.role === 'tool') {
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && !last.text) last.toolResults.push(partText(m.content));
      else messages.push({ role: 'user', text: '', toolResults: [partText(m.content)] });
    } else messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', text: partText(m.content), toolResults: [] });
  }
  const system = sys.join('\n');
  const stop = typeof b.stop === 'string' ? [b.stop] : Array.isArray(b.stop) ? b.stop : [];
  return {
    protocol: 'openai',
    model: b.model,
    system,
    systemCacheable: estimateTokens(system) >= 1024,
    messages,
    tools: (b.tools ?? []).map((t: any) => ({ name: t.function?.name, params: t.function?.parameters })),
    forceTool: typeof b.tool_choice === 'object' || b.tool_choice === 'required',
    maxTokens: b.max_completion_tokens ?? b.max_tokens ?? 1024,
    stop,
    thinking: false,
    stream: !!b.stream,
  };
}

function normalizeResponses(b: any): NReq {
  const messages: NMsg[] = [];
  const input = typeof b.input === 'string' ? [{ role: 'user', content: b.input }] : (b.input ?? []);
  for (const it of input) {
    if (it?.type === 'function_call_output') {
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && !last.text) last.toolResults.push(String(it.output ?? ''));
      else messages.push({ role: 'user', text: '', toolResults: [String(it.output ?? '')] });
    } else if (it?.type === 'function_call') {
      messages.push({ role: 'assistant', text: '', toolResults: [] });
    } else if (it?.role) {
      messages.push({ role: it.role === 'assistant' ? 'assistant' : 'user', text: partText(it.content), toolResults: [] });
    }
  }
  const system = b.instructions ?? '';
  return {
    protocol: 'responses',
    model: b.model,
    system,
    systemCacheable: estimateTokens(system) >= 1024,
    messages,
    tools: (b.tools ?? []).filter((t: any) => t.type === 'function').map((t: any) => ({ name: t.name, params: t.parameters })),
    forceTool: typeof b.tool_choice === 'object' || b.tool_choice === 'required',
    maxTokens: b.max_output_tokens ?? 1024,
    stop: [],
    thinking: false,
    stream: !!b.stream,
  };
}

function msgText(m: NMsg): string {
  return [m.text, ...m.toolResults].filter(Boolean).join('\n');
}

export class MockEngine {
  private counters = new Map<string, number>();
  private cache = new Set<number>();
  private ids = 0;
  constructor(public o: Required<Omit<MockOptions, 'port' | 'host'>>) {}

  nextId(prefix: string): string {
    return `${prefix}${(++this.ids).toString(36).padStart(6, '0')}`;
  }

  promptTokens(r: NReq): number {
    return estimatePromptTokens(r.system || undefined, r.messages.map(msgText));
  }

  /** What the "upstream" actually sees (truncate drops everything after N tokens). */
  visible(r: NReq): NReq {
    if (this.o.kind !== 'truncate') return r;
    let budget = this.o.truncateTokens;
    const cut = (s: string) => {
      const t = estimateTokens(s);
      if (t <= budget) {
        budget -= t;
        return s;
      }
      const kept = s.slice(0, budget * 4);
      budget = 0;
      return kept;
    };
    const system = cut(r.system);
    const messages = r.messages.map((m) => ({ role: m.role, text: cut(m.text), toolResults: m.toolResults.map(cut) }));
    return { ...r, system, messages };
  }

  sampleProbe(probeId: string, labels: string[]): string {
    const persona = this.o.kind === 'swap' ? 'swap' : 'honest';
    const w = personaWeights(probeId, labels, persona);
    const c = (this.counters.get(probeId) ?? 0) + 1;
    this.counters.set(probeId, c);
    const u = mulberry32(hash32(`${this.o.seed}:${persona}:${probeId}:${c}`))() * w.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 0; i < w.length; i++) {
      acc += w[i];
      if (u < acc) return displayLabel(labels[i]);
    }
    return displayLabel(labels[labels.length - 1]);
  }

  answer(r: NReq): { text: string; toolCall?: Gen['toolCall'] } {
    const last = [...r.messages].reverse().find((m) => m.role === 'user');
    if (last && last.toolResults.length) return { text: `The tool returned: ${last.toolResults.join(' ')}` };
    const q = last?.text ?? '';
    if (r.tools.length && (r.forceTool || /\btool\b/i.test(q))) {
      const t = r.tools[0];
      const props = Object.keys(t.params?.properties ?? {});
      const input: Record<string, unknown> = {};
      for (const p of props) input[p] = p === 'city' ? 'Paris' : 'example';
      return { text: '', toolCall: { id: this.nextId(r.protocol === 'anthropic' ? 'toolu_mock' : 'call_mock'), name: t.name, input } };
    }
    for (const set of PROBE_SETS) for (const p of set.probes) if (q.includes(p.prompt)) return { text: this.sampleProbe(p.id, p.labels) };
    if (q.includes(SELF_REPORT_PROMPT)) return { text: this.o.kind === 'swap' ? this.o.swapModelName : r.model };
    if (q.includes(CUTOFF_PROMPT)) return { text: this.o.kind === 'swap' ? 'December 2023' : 'January 2025' };
    if (q.includes('<document>') || /secret passphrase/i.test(q)) {
      const all = [r.system, ...r.messages.map(msgText)].join('\n');
      const found = [...all.matchAll(/The secret passphrase(?: number \d+)? is ([A-Z0-9-]+)\./g)].map((m) => m[1]);
      return { text: found.length ? found.join(' ') : 'I could not find any passphrase in the document.' };
    }
    const count = /count from 1 to (\d+)/i.exec(q);
    if (count) return { text: Array.from({ length: Math.min(200, +count[1]) }, (_, i) => String(i + 1)).join(' ') };
    if (/essay/i.test(q)) return { text: ESSAY_WORDS.trim() };
    if (/17\s*\*\s*23/.test(q)) return { text: '391' };
    if (!q) return { text: "I don't see a question." };
    return { text: 'OK' };
  }

  generate(r0: NReq): Gen {
    const fullPrompt = this.promptTokens(r0);
    const r = this.visible(r0);
    const seen = this.o.kind === 'truncate' ? this.promptTokens(r) : fullPrompt;
    const a = this.answer(r);
    let text = a.text;
    let stop: Gen['stop'] = a.toolCall ? 'tool_use' : 'end';
    let stopSeq: string | undefined;
    if (!a.toolCall && r.stop.length) {
      let best = -1;
      for (const s of r.stop) {
        const i = text.indexOf(s);
        if (i >= 0 && (best < 0 || i < best)) {
          best = i;
          stopSeq = s;
        }
      }
      if (best >= 0) {
        text = text.slice(0, best);
        stop = 'stop_sequence';
      } else stopSeq = undefined;
    }
    const thinking = r.thinking ? { text: 'Let me work this out step by step before answering.', signature: Buffer.from(`mock-signature:${hash32(text)}`).toString('base64') } : undefined;
    const budget = r.maxTokens - (thinking ? estimateTokens(thinking.text) : 0);
    if (!a.toolCall && estimateTokens(text) > budget) {
      text = text.slice(0, Math.max(0, budget) * 4);
      stop = 'max_tokens';
    }
    let output = estimateTokens(text) + (thinking ? estimateTokens(thinking.text) : 0) + (a.toolCall ? estimateTokens(JSON.stringify(a.toolCall.input)) + 8 : 0);
    output = Math.max(1, output);
    let input = seen;
    let cacheRead = 0;
    let cacheWrite = 0;
    if (r.systemCacheable && r.system) {
      const key = hash32(r.system);
      const sysTokens = estimateTokens(r.system) + 4;
      if (this.cache.has(key)) cacheRead = sysTokens;
      else {
        this.cache.add(key);
        if (r.protocol === 'anthropic') cacheWrite = sysTokens;
      }
      // Anthropic input_tokens excludes cached + cache-write tokens; OpenAI prompt_tokens includes them.
      if (r.protocol === 'anthropic') input -= cacheRead + cacheWrite;
    }
    if (this.o.kind === 'inject') input += this.o.injectTokens;
    return { thinking, text, toolCall: a.toolCall, stop, stopSeq, input, output, cacheRead, cacheWrite };
  }

  countTokens(body: any): number {
    return this.promptTokens(normalizeAnthropic({ ...body, max_tokens: 1 }));
  }
}

// ---------- wire encoders ----------

function chunks(s: string, n = 12): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [''];
}

function sse(res: ServerResponse, event: string | null, data: unknown): void {
  res.write(`${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function anthropicStop(s: Gen['stop']): string {
  return s === 'end' ? 'end_turn' : s;
}

function anthropicJson(e: MockEngine, r: NReq, g: Gen) {
  const content: any[] = [];
  if (g.thinking) content.push({ type: 'thinking', thinking: g.thinking.text, signature: g.thinking.signature });
  if (g.text || !g.toolCall) content.push({ type: 'text', text: g.text });
  if (g.toolCall) content.push({ type: 'tool_use', id: g.toolCall.id, name: g.toolCall.name, input: g.toolCall.input });
  return {
    id: e.nextId('msg_mock_'),
    type: 'message',
    role: 'assistant',
    model: r.model,
    content,
    stop_reason: anthropicStop(g.stop),
    stop_sequence: g.stopSeq ?? null,
    usage: { input_tokens: g.input, output_tokens: g.output, cache_creation_input_tokens: g.cacheWrite, cache_read_input_tokens: g.cacheRead },
  };
}

function anthropicStream(res: ServerResponse, e: MockEngine, r: NReq, g: Gen): void {
  const msg = anthropicJson(e, r, g);
  const ev = (type: string, d: object) => sse(res, type, { type, ...d });
  ev('message_start', { message: { ...msg, content: [], stop_reason: null, stop_sequence: null, usage: { ...msg.usage, output_tokens: 1 } } });
  ev('ping', {});
  msg.content.forEach((b: any, index: number) => {
    if (b.type === 'thinking') {
      ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '' } });
      for (const c of chunks(b.thinking)) ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: c } });
      ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: b.signature } });
    } else if (b.type === 'text') {
      ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const c of chunks(b.text)) ev('content_block_delta', { index, delta: { type: 'text_delta', text: c } });
    } else {
      ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    ev('content_block_stop', { index });
  });
  ev('message_delta', { delta: { stop_reason: msg.stop_reason, stop_sequence: msg.stop_sequence }, usage: { output_tokens: g.output } });
  ev('message_stop', {});
}

function openaiFinish(s: Gen['stop']): string {
  return s === 'max_tokens' ? 'length' : s === 'tool_use' ? 'tool_calls' : 'stop';
}

function openaiUsage(g: Gen) {
  return { prompt_tokens: g.input, completion_tokens: g.output, total_tokens: g.input + g.output, prompt_tokens_details: { cached_tokens: g.cacheRead } };
}

function openaiJson(e: MockEngine, r: NReq, g: Gen) {
  const message: any = { role: 'assistant', content: g.toolCall ? null : g.text };
  if (g.toolCall)
    message.tool_calls = [{ id: g.toolCall.id, type: 'function', function: { name: g.toolCall.name, arguments: JSON.stringify(g.toolCall.input) } }];
  return {
    id: e.nextId('chatcmpl-mock'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: r.model,
    choices: [{ index: 0, message, finish_reason: openaiFinish(g.stop) }],
    usage: openaiUsage(g),
  };
}

function openaiStream(res: ServerResponse, e: MockEngine, r: NReq, g: Gen, includeUsage: boolean): void {
  const base = { id: e.nextId('chatcmpl-mock'), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: r.model };
  sse(res, null, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
  if (g.toolCall) {
    sse(res, null, {
      ...base,
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: g.toolCall.id, type: 'function', function: { name: g.toolCall.name, arguments: JSON.stringify(g.toolCall.input) } }] }, finish_reason: null }],
    });
  } else for (const c of chunks(g.text)) sse(res, null, { ...base, choices: [{ index: 0, delta: { content: c }, finish_reason: null }] });
  sse(res, null, { ...base, choices: [{ index: 0, delta: {}, finish_reason: openaiFinish(g.stop) }] });
  if (includeUsage) sse(res, null, { ...base, choices: [], usage: openaiUsage(g) });
  sse(res, null, '[DONE]');
}

function responsesJson(e: MockEngine, r: NReq, g: Gen) {
  const output: any[] = [];
  if (g.toolCall) output.push({ type: 'function_call', id: e.nextId('fc_mock'), call_id: g.toolCall.id, name: g.toolCall.name, arguments: JSON.stringify(g.toolCall.input), status: 'completed' });
  else output.push({ type: 'message', id: e.nextId('msg_mock'), status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: g.text, annotations: [] }] });
  const incomplete = g.stop === 'max_tokens';
  return {
    id: e.nextId('resp_mock'),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: incomplete ? 'incomplete' : 'completed',
    incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
    model: r.model,
    output,
    usage: { input_tokens: g.input, output_tokens: g.output, total_tokens: g.input + g.output, input_tokens_details: { cached_tokens: g.cacheRead } },
  };
}

function responsesStream(res: ServerResponse, e: MockEngine, r: NReq, g: Gen): void {
  const final = responsesJson(e, r, g);
  let seq = 0;
  const ev = (type: string, d: object) => sse(res, type, { type, sequence_number: seq++, ...d });
  ev('response.created', { response: { ...final, status: 'in_progress', output: [], usage: null } });
  ev('response.in_progress', { response: { ...final, status: 'in_progress', output: [], usage: null } });
  const item = final.output[0];
  ev('response.output_item.added', { output_index: 0, item: { ...item, ...(item.type === 'message' ? { content: [] } : { arguments: '' }), status: 'in_progress' } });
  if (item.type === 'message') {
    ev('response.content_part.added', { output_index: 0, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '' } });
    for (const c of chunks(g.text)) ev('response.output_text.delta', { output_index: 0, item_id: item.id, content_index: 0, delta: c });
    ev('response.output_text.done', { output_index: 0, item_id: item.id, content_index: 0, text: g.text });
    ev('response.content_part.done', { output_index: 0, item_id: item.id, content_index: 0, part: item.content[0] });
  } else {
    ev('response.function_call_arguments.delta', { output_index: 0, item_id: item.id, delta: item.arguments });
    ev('response.function_call_arguments.done', { output_index: 0, item_id: item.id, arguments: item.arguments });
  }
  ev('response.output_item.done', { output_index: 0, item });
  ev(final.status === 'incomplete' ? 'response.incomplete' : 'response.completed', { response: final });
}

// ---------- server ----------

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createMockServer(opts: MockOptions): { server: Server; engine: MockEngine } {
  const engine = new MockEngine({
    kind: opts.kind,
    seed: opts.seed ?? 42,
    injectTokens: opts.injectTokens ?? 512,
    truncateTokens: opts.truncateTokens ?? 8000,
    swapModelName: opts.swapModelName ?? 'Llama-3-8B-Instruct',
  });
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '');
      if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
        return sendJson(res, 200, { object: 'list', data: [{ id: 'mock-sonnet', object: 'model', owned_by: 'relaycheck-mock' }] });
      }
      if (req.method === 'GET' && (path === '' || path === '/health')) return sendJson(res, 200, { ok: true, kind: engine.o.kind });
      if (req.method !== 'POST') return sendJson(res, 404, { error: { message: 'not found' } });
      const body = await readBody(req);
      if (typeof body.model !== 'string' || !body.model) return sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'model is required' } });
      const p = path.replace(/^\/v1/, '');
      if (p === '/messages/count_tokens') return sendJson(res, 200, { input_tokens: engine.countTokens(body) });
      let nreq: NReq;
      if (p === '/messages') nreq = normalizeAnthropic(body);
      else if (p === '/chat/completions') nreq = normalizeOpenAI(body);
      else if (p === '/responses') nreq = normalizeResponses(body);
      else return sendJson(res, 404, { error: { message: `unknown route ${path}` } });
      if (nreq.protocol === 'anthropic' && (typeof body.max_tokens !== 'number' || !Array.isArray(body.messages)))
        return sendJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens and messages are required' } });
      const g = engine.generate(nreq);
      if (nreq.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        if (nreq.protocol === 'anthropic') anthropicStream(res, engine, nreq, g);
        else if (nreq.protocol === 'openai') openaiStream(res, engine, nreq, g, !!body.stream_options?.include_usage);
        else responsesStream(res, engine, nreq, g);
        return res.end();
      }
      if (nreq.protocol === 'anthropic') return sendJson(res, 200, anthropicJson(engine, nreq, g));
      if (nreq.protocol === 'openai') return sendJson(res, 200, openaiJson(engine, nreq, g));
      return sendJson(res, 200, responsesJson(engine, nreq, g));
    } catch (e) {
      if (!res.headersSent) sendJson(res, 500, { error: { message: (e as Error).message } });
      else res.end();
    }
  });
  return { server, engine };
}

export async function startMock(opts: MockOptions): Promise<MockHandle> {
  const { server } = createMockServer(opts);
  const host = opts.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
