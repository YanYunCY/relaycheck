import { HttpError, joinUrl, postJson, postSse, safeJson } from './http.js';
import {
  type Adapter,
  type AdapterOptions,
  type Block,
  type ChatRequest,
  type ChatResponse,
  type Msg,
  type StopReason,
  type StreamResult,
  emptyUsage,
  num,
} from './types.js';

export const ANTHROPIC_VERSION = '2023-06-01';

function headers(key: string): Record<string, string> {
  const h: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION };
  if (key) {
    h['x-api-key'] = key;
    // many relays expect Bearer auth on the Anthropic route as well
    h['authorization'] = `Bearer ${key}`;
  }
  return h;
}

function convertBlock(b: Block): Record<string, unknown> {
  if (b.type === 'text') return { type: 'text', text: b.text };
  if (b.type === 'tool_call') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
  return { type: 'tool_result', tool_use_id: b.id, content: b.content };
}

function convertMsg(m: Msg): Record<string, unknown> {
  return { role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(convertBlock) };
}

export function anthropicBody(req: ChatRequest, stream: boolean, forCount = false): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, messages: req.messages.map(convertMsg) };
  if (!forCount) body.max_tokens = req.maxTokens;
  if (req.system) {
    body.system = req.cacheSystem
      ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }]
      : req.system;
  }
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (req.toolChoice && !forCount) body.tool_choice = { type: 'tool', name: req.toolChoice };
  }
  if (req.thinkingBudget) body.thinking = { type: 'enabled', budget_tokens: req.thinkingBudget };
  if (forCount) return body;
  if (req.temperature !== undefined && !req.thinkingBudget) body.temperature = req.temperature;
  if (req.stop?.length) body.stop_sequences = req.stop;
  if (stream) body.stream = true;
  return body;
}

export function mapAnthropicStop(s: string | null | undefined): StopReason {
  switch (s) {
    case 'end_turn':
      return 'end';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'other';
  }
}

export function parseAnthropic(raw: any): ChatResponse {
  const content: any[] = Array.isArray(raw?.content) ? raw.content : [];
  const usage = raw?.usage ?? {};
  return {
    text: content
      .filter((b) => b?.type === 'text')
      .map((b) => b.text ?? '')
      .join(''),
    toolCalls: content
      .filter((b) => b?.type === 'tool_use')
      .map((b) => ({ id: String(b.id ?? ''), name: String(b.name ?? ''), input: b.input ?? {} })),
    thinking: content
      .filter((b) => b?.type === 'thinking' || b?.type === 'redacted_thinking')
      .map((b) => ({ text: b.thinking ?? '', signature: b.signature ?? (b.type === 'redacted_thinking' ? b.data : undefined) })),
    stopReason: mapAnthropicStop(raw?.stop_reason),
    rawStopReason: raw?.stop_reason ?? null,
    model: typeof raw?.model === 'string' ? raw.model : null,
    usage: {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
    },
    raw,
  };
}

export class AnthropicAdapter implements Adapter {
  kind = 'anthropic' as const;
  supportsStop = true;
  supportsThinking = true;
  minMaxTokens = 1;
  private countUnsupported = false;
  constructor(private o: AdapterOptions) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const raw = await postJson(joinUrl(this.o.baseUrl, '/messages'), headers(this.o.key), anthropicBody(req, false), this.o);
    if (raw?.type === 'error') throw new Error(`anthropic error: ${JSON.stringify(raw.error).slice(0, 300)}`);
    return parseAnthropic(raw);
  }

  async countTokens(req: ChatRequest): Promise<number | null> {
    if (this.countUnsupported) return null;
    try {
      const raw = await postJson(
        joinUrl(this.o.baseUrl, '/messages/count_tokens'),
        headers(this.o.key),
        anthropicBody(req, false, true),
        { ...this.o, retries: 0 },
      );
      const n = num(raw?.input_tokens);
      if (n === null) this.countUnsupported = true;
      return n;
    } catch (e) {
      if (e instanceof HttpError) this.countUnsupported = true;
      return null;
    }
  }

  async stream(req: ChatRequest): Promise<StreamResult> {
    const { events, contentType } = await postSse(
      joinUrl(this.o.baseUrl, '/messages'),
      headers(this.o.key),
      anthropicBody(req, true),
      this.o,
    );
    const problems: string[] = [];
    if (!contentType.includes('text/event-stream')) problems.push(`content-type is "${contentType}", expected text/event-stream`);
    const names: string[] = [];
    let text = '';
    let rawStop: string | null = null;
    let model: string | null = null;
    const usage = emptyUsage();
    const open = new Set<number>();
    let sawDelta = false;
    for (const ev of events) {
      const data = safeJson(ev.data);
      const name = ev.event ?? data?.type ?? 'unknown';
      names.push(name);
      if (data === undefined) {
        problems.push(`unparseable data in "${name}" event`);
        continue;
      }
      if (ev.event && data?.type && ev.event !== data.type) problems.push(`event name "${ev.event}" != data.type "${data.type}"`);
      switch (name) {
        case 'message_start':
          model = data?.message?.model ?? null;
          usage.input = num(data?.message?.usage?.input_tokens);
          usage.cacheRead = num(data?.message?.usage?.cache_read_input_tokens);
          usage.cacheWrite = num(data?.message?.usage?.cache_creation_input_tokens);
          break;
        case 'content_block_start':
          if (open.has(data.index)) problems.push(`content block ${data.index} started twice`);
          open.add(data.index);
          break;
        case 'content_block_delta':
          if (!open.has(data.index)) problems.push(`delta for unopened block ${data.index}`);
          if (data?.delta?.type === 'text_delta') text += data.delta.text ?? '';
          break;
        case 'content_block_stop':
          if (!open.has(data.index)) problems.push(`stop for unopened block ${data.index}`);
          open.delete(data.index);
          break;
        case 'message_delta':
          sawDelta = true;
          rawStop = data?.delta?.stop_reason ?? null;
          usage.output = num(data?.usage?.output_tokens);
          // newer API versions repeat the final input/cache counts here
          if (num(data?.usage?.input_tokens) !== null) usage.input = num(data.usage.input_tokens);
          break;
        case 'error':
          problems.push(`error event: ${JSON.stringify(data?.error ?? data).slice(0, 200)}`);
          break;
      }
    }
    const significant = names.filter((n) => n !== 'ping');
    if (significant[0] !== 'message_start') problems.push(`first event is "${significant[0] ?? 'none'}", expected message_start`);
    if (significant[significant.length - 1] !== 'message_stop')
      problems.push(`last event is "${significant[significant.length - 1] ?? 'none'}", expected message_stop`);
    if (open.size) problems.push(`content blocks never closed: ${[...open].join(',')}`);
    if (!sawDelta) problems.push('no message_delta (stop_reason/usage missing)');
    return { events: names, text, stopReason: mapAnthropicStop(rawStop), rawStopReason: rawStop, model, usage, problems };
  }
}
