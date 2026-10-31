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

export function openaiMessages(req: ChatRequest): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });
  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n');
    if (m.role === 'assistant') {
      const calls = m.content.filter((b) => b.type === 'tool_call') as Extract<(typeof m.content)[number], { type: 'tool_call' }>[];
      const msg: Record<string, unknown> = { role: 'assistant', content: text || null };
      if (calls.length)
        msg.tool_calls = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        }));
      out.push(msg);
    } else {
      for (const b of m.content) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.id, content: b.content });
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

export function mapOpenAIStop(s: string | null | undefined): StopReason {
  switch (s) {
    case 'stop':
      return 'end';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    default:
      return 'other';
  }
}

export class OpenAIChatAdapter implements Adapter {
  kind = 'openai' as const;
  supportsStop = true;
  supportsThinking = false;
  minMaxTokens = 1;
  private useCompletionTokens = false;
  private dropTemperature = false;
  constructor(private o: AdapterOptions) {}

  body(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = { model: req.model, messages: openaiMessages(req) };
    const effort = this.o.reasoningEffort;
    // reasoning tokens count against the limit; give short-answer probes room (truncation probes stay small)
    const maxTokens = effort && !req.exactMaxTokens ? Math.max(req.maxTokens, 128) : req.maxTokens;
    body[this.useCompletionTokens || effort ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
    if (effort) body.reasoning_effort = effort;
    if (req.temperature !== undefined && !this.dropTemperature) body.temperature = req.temperature;
    if (req.stop?.length) body.stop = req.stop;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      if (req.toolChoice) body.tool_choice = { type: 'function', function: { name: req.toolChoice } };
    }
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  private async post(req: ChatRequest, stream: boolean): Promise<any> {
    const url = joinUrl(this.o.baseUrl, '/chat/completions');
    const send = () =>
      stream ? postSse(url, headers(this.o.key), this.body(req, true), this.o) : postJson(url, headers(this.o.key), this.body(req, false), this.o);
    // adapt to the endpoint at most once per quirk (max_tokens → max_completion_tokens, no temperature)
    for (let i = 0; ; i++) {
      try {
        return await send();
      } catch (e) {
        if (i < 2 && e instanceof HttpError && e.status === 400) {
          if (!this.useCompletionTokens && /max_completion_tokens/.test(e.body)) {
            this.useCompletionTokens = true;
            continue;
          }
          if (!this.dropTemperature && /temperature/i.test(e.body)) {
            this.dropTemperature = true; // reasoning models only accept the default temperature (1)
            continue;
          }
        }
        throw e;
      }
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const raw = await this.post(req, false);
    if (raw?.error) throw new Error(`openai error: ${JSON.stringify(raw.error).slice(0, 300)}`);
    const choice = raw?.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const usage = raw?.usage ?? {};
    const content = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p: any) => p?.text ?? '').join('') : '';
    return {
      text: content,
      toolCalls: (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c: any) => ({
        id: String(c.id ?? ''),
        name: String(c.function?.name ?? ''),
        input: safeJson(c.function?.arguments ?? '{}') ?? {},
      })),
      thinking: typeof msg.reasoning_content === 'string' && msg.reasoning_content ? [{ text: msg.reasoning_content }] : [],
      stopReason: mapOpenAIStop(choice.finish_reason),
      rawStopReason: choice.finish_reason ?? null,
      model: typeof raw?.model === 'string' ? raw.model : null,
      usage: {
        input: num(usage.prompt_tokens),
        output: num(usage.completion_tokens),
        cacheRead: num(usage.prompt_tokens_details?.cached_tokens),
        cacheWrite: null,
      },
      raw,
    };
  }

  async countTokens(): Promise<number | null> {
    return null;
  }

  async stream(req: ChatRequest): Promise<StreamResult> {
    const { events, contentType } = await this.post(req, true);
    const problems: string[] = [];
    if (!contentType.includes('text/event-stream')) problems.push(`content-type is "${contentType}", expected text/event-stream`);
    const names: string[] = [];
    let text = '';
    let rawStop: string | null = null;
    let model: string | null = null;
    const usage = emptyUsage();
    let done = false;
    for (const ev of events as { event: string | null; data: string }[]) {
      if (ev.data.trim() === '[DONE]') {
        names.push('[DONE]');
        if (done) problems.push('duplicate [DONE]');
        done = true;
        continue;
      }
      if (done) problems.push('data after [DONE]');
      const d = safeJson(ev.data);
      names.push(ev.event ?? 'chunk');
      if (d === undefined) {
        problems.push('unparseable chunk');
        continue;
      }
      if (d.error) problems.push(`error chunk: ${JSON.stringify(d.error).slice(0, 200)}`);
      if (d.object && d.object !== 'chat.completion.chunk') problems.push(`chunk object "${d.object}"`);
      model ??= d.model ?? null;
      const c = d.choices?.[0];
      if (c?.delta?.content) text += c.delta.content;
      if (c?.finish_reason) rawStop = c.finish_reason;
      if (d.usage) {
        usage.input = num(d.usage.prompt_tokens);
        usage.output = num(d.usage.completion_tokens);
        usage.cacheRead = num(d.usage.prompt_tokens_details?.cached_tokens);
      }
    }
    if (!done) problems.push('stream did not end with data: [DONE]');
    if (!rawStop) problems.push('no chunk carried finish_reason');
    return { events: names, text, stopReason: mapOpenAIStop(rawStop), rawStopReason: rawStop, model, usage, problems };
  }
}
