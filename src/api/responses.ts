import { HttpError, joinUrl, postJson, postSse, safeJson } from './http.js';
import {
  type Adapter,
  type AdapterOptions,
  type ChatRequest,
  type ChatResponse,
  type StopReason,
  type StreamResult,
  emptyUsage,
  num,
} from './types.js';

function headers(key: string): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {};
}

export function responsesInput(req: ChatRequest): unknown[] {
  const items: unknown[] = [];
  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      items.push({ role: m.role, content: m.content });
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'text') items.push({ role: m.role, content: b.text });
      else if (b.type === 'tool_call')
        items.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: JSON.stringify(b.input) });
      else items.push({ type: 'function_call_output', call_id: b.id, output: b.content });
    }
  }
  return items;
}

export function parseResponsesObject(raw: any): ChatResponse {
  const output: any[] = Array.isArray(raw?.output) ? raw.output : [];
  let text = '';
  const toolCalls: ChatResponse['toolCalls'] = [];
  const thinking: ChatResponse['thinking'] = [];
  for (const item of output) {
    if (item?.type === 'message') {
      for (const c of item.content ?? []) {
        if (c?.type === 'output_text') text += c.text ?? '';
        else if (c?.type === 'refusal') text += c.refusal ?? '';
      }
    } else if (item?.type === 'function_call') {
      toolCalls.push({ id: String(item.call_id ?? item.id ?? ''), name: String(item.name ?? ''), input: safeJson(item.arguments ?? '{}') ?? {} });
    } else if (item?.type === 'reasoning') {
      thinking.push({
        text: (item.summary ?? []).map((s: any) => s?.text ?? '').join(''),
        signature: item.encrypted_content ?? undefined,
      });
    }
  }
  let stop: StopReason = 'other';
  let rawStop: string | null = raw?.status ?? null;
  if (raw?.status === 'incomplete') {
    rawStop = `incomplete:${raw?.incomplete_details?.reason ?? '?'}`;
    if (raw?.incomplete_details?.reason === 'max_output_tokens') stop = 'max_tokens';
  } else if (toolCalls.length) stop = 'tool_use';
  else if (raw?.status === 'completed') stop = 'end';
  const usage = raw?.usage ?? {};
  return {
    text,
    toolCalls,
    thinking,
    stopReason: stop,
    rawStopReason: rawStop,
    model: typeof raw?.model === 'string' ? raw.model : null,
    usage: {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.input_tokens_details?.cached_tokens),
      cacheWrite: null,
    },
    raw,
  };
}

export class ResponsesAdapter implements Adapter {
  kind = 'responses' as const;
  supportsStop = false;
  supportsThinking = false;
  minMaxTokens = 16;
  private dropTemperature = false;
  constructor(private o: AdapterOptions) {}

  private async send<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!this.dropTemperature && e instanceof HttpError && e.status === 400 && /temperature/i.test(e.body)) {
        this.dropTemperature = true;
        return await fn();
      }
      throw e;
    }
  }

  body(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      input: responsesInput(req),
      max_output_tokens: Math.max(this.minMaxTokens, this.o.reasoningEffort && !req.exactMaxTokens ? Math.max(req.maxTokens, 128) : req.maxTokens),
      store: false,
    };
    if (this.o.reasoningEffort) body.reasoning = { effort: this.o.reasoningEffort };
    if (req.system) body.instructions = req.system;
    if (req.temperature !== undefined && !this.dropTemperature) body.temperature = req.temperature;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
      if (req.toolChoice) body.tool_choice = { type: 'function', name: req.toolChoice };
    }
    if (stream) body.stream = true;
    return body;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const raw = await this.send(() => postJson(joinUrl(this.o.baseUrl, '/responses'), headers(this.o.key), this.body(req, false), this.o));
    if (raw?.error) throw new Error(`responses error: ${JSON.stringify(raw.error).slice(0, 300)}`);
    return parseResponsesObject(raw);
  }

  async countTokens(): Promise<number | null> {
    return null;
  }

  async stream(req: ChatRequest): Promise<StreamResult> {
    const { events, contentType } = await this.send(() => postSse(joinUrl(this.o.baseUrl, '/responses'), headers(this.o.key), this.body(req, true), this.o));
    const problems: string[] = [];
    if (!contentType.includes('text/event-stream')) problems.push(`content-type is "${contentType}", expected text/event-stream`);
    const names: string[] = [];
    let text = '';
    let final: ChatResponse | null = null;
    let model: string | null = null;
    for (const ev of events) {
      const d = safeJson(ev.data);
      const name = ev.event ?? d?.type ?? 'unknown';
      names.push(name);
      if (d === undefined) {
        problems.push(`unparseable data in "${name}"`);
        continue;
      }
      if (name === 'response.created') model = d.response?.model ?? null;
      if (name === 'response.output_text.delta') text += d.delta ?? '';
      if (name === 'response.completed' || name === 'response.incomplete') final = parseResponsesObject(d.response);
      if (name === 'error' || name === 'response.failed') problems.push(`${name}: ${JSON.stringify(d).slice(0, 200)}`);
    }
    if (names[0] !== 'response.created') problems.push(`first event is "${names[0] ?? 'none'}", expected response.created`);
    const last = names[names.length - 1];
    if (last !== 'response.completed' && last !== 'response.incomplete') problems.push(`last event is "${last ?? 'none'}", expected response.completed`);
    if (final && final.text && text && final.text !== text) problems.push('streamed deltas do not match final response text');
    return {
      events: names,
      text,
      stopReason: final?.stopReason ?? 'other',
      rawStopReason: final?.rawStopReason ?? null,
      model: model ?? final?.model ?? null,
      usage: final?.usage ?? emptyUsage(),
      problems,
    };
  }
}
