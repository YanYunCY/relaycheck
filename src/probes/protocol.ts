import { HttpError } from '../api/http.js';
import type { ToolDef } from '../api/types.js';
import { randomHex } from '../rng.js';
import { type CheckResult, type GroupResult, l, worstStatus } from '../types.js';
import { type ProbeContext, guard, result } from './common.js';

export const WEATHER_TOOL: ToolDef = {
  name: 'get_weather',
  description: 'Get the current weather for a city. Returns a verification code that must be quoted back to the user.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
};

export function modelEchoMatches(requested: string, echoed: string | null): boolean {
  if (!echoed) return false;
  const a = requested.toLowerCase().replace(/^.*\//, '');
  const b = echoed.toLowerCase().replace(/^.*\//, '');
  return a === b || b.startsWith(a) || a.startsWith(b);
}

async function toolRoundTrip(ctx: ProbeContext): Promise<CheckResult> {
  const id = 'protocol.tool_use';
  const title = l('工具调用往返', 'Tool-use round trip');
  return guard(id, title, async () => {
    const code = `WX-${randomHex(6)}`;
    const user = { role: 'user' as const, content: 'Use the get_weather tool to look up the weather in Paris, then tell me the verification code it returns.' };
    const r1 = await ctx.adapter.chat({ model: ctx.model, messages: [user], tools: [WEATHER_TOOL], toolChoice: WEATHER_TOOL.name, maxTokens: 256, temperature: 0 });
    const call = r1.toolCalls[0];
    if (!call) return result(id, 'fail', title, l('模型没有发起工具调用（工具定义可能被中转丢弃）', 'no tool call returned (tool definitions may be dropped by the relay)'), { stopReason: r1.rawStopReason, text: r1.text.slice(0, 200) });
    if (call.name !== WEATHER_TOOL.name || typeof call.input?.city !== 'string')
      return result(id, 'fail', title, l(`工具调用格式错误：${call.name}(${JSON.stringify(call.input)})`, `malformed tool call: ${call.name}(${JSON.stringify(call.input)})`), { call });
    const r2 = await ctx.adapter.chat({
      model: ctx.model,
      tools: [WEATHER_TOOL],
      maxTokens: 256,
      temperature: 0,
      messages: [
        user,
        { role: 'assistant', content: [{ type: 'tool_call', id: call.id, name: call.name, input: call.input }] },
        { role: 'user', content: [{ type: 'tool_result', id: call.id, name: call.name, content: `Sunny, 21°C. Verification code: ${code}` }] },
      ],
    });
    const evidence = { call, firstStop: r1.rawStopReason, finalText: r2.text.slice(0, 300), code };
    if (!r2.text.includes(code)) return result(id, 'fail', title, l('最终答复没有引用工具结果（tool_result 未送达模型）', 'final answer did not use the tool result (tool_result not delivered)'), evidence);
    if (r1.stopReason !== 'tool_use')
      return result(id, 'warn', title, l(`往返成功，但首轮 stop_reason=${r1.rawStopReason}（应为 tool_use）`, `round trip ok, but first stop_reason=${r1.rawStopReason} (expected tool_use)`), evidence);
    return result(id, 'pass', title, l('定义→调用→回传→答复 全链路正常', 'define → call → result → answer all intact'), evidence);
  });
}

async function sse(ctx: ProbeContext): Promise<CheckResult> {
  const id = 'protocol.sse';
  const title = l('SSE 流完整性', 'SSE stream integrity');
  return guard(id, title, async () => {
    const s = await ctx.adapter.stream({ model: ctx.model, messages: [{ role: 'user', content: 'Count from 1 to 10, separated by single spaces. Output only the numbers.' }], maxTokens: 64, temperature: 0 });
    const evidence = { eventCount: s.events.length, events: s.events.slice(0, 40), problems: s.problems, text: s.text.slice(0, 120), stop: s.rawStopReason, usage: s.usage };
    if (!s.text.trim()) return result(id, 'fail', title, l('流中没有任何文本增量', 'stream carried no text deltas'), evidence);
    if (s.problems.length) return result(id, 'fail', title, l(`事件序列异常：${s.problems.slice(0, 2).join('；')}`, `event sequence problems: ${s.problems.slice(0, 2).join('; ')}`), evidence);
    return result(id, 'pass', title, l(`${s.events.length} 个事件，序列完整`, `${s.events.length} events, sequence intact`), evidence);
  });
}

async function stopSequences(ctx: ProbeContext): Promise<CheckResult> {
  const id = 'protocol.stop_sequences';
  const title = l('stop_sequences', 'stop_sequences');
  if (!ctx.adapter.supportsStop) return result(id, 'skip', title, l('该协议不支持 stop 参数', 'not supported by this API'));
  return guard(id, title, async () => {
    let r;
    try {
      r = await ctx.adapter.chat({ model: ctx.model, messages: [{ role: 'user', content: 'Count from 1 to 20, separated by single spaces. Output only the numbers.' }], maxTokens: 128, temperature: 0, stop: ['11'] });
    } catch (e) {
      // e.g. OpenAI reasoning models reject `stop`; that is the model's API, not a relay fault
      if (e instanceof HttpError && e.status === 400 && /\bstop\b/i.test(e.body) && /unsupported|not supported|does not support/i.test(e.body))
        return result(id, 'skip', title, l('该模型不支持 stop 参数（上游 400）', 'this model does not support the stop parameter (upstream 400)'), { error: e.body.slice(0, 200) });
      throw e;
    }
    const evidence = { text: r.text.slice(0, 120), stop: r.rawStopReason };
    if (/\b1[2-9]\b|\b20\b/.test(r.text)) return result(id, 'fail', title, l('输出越过了停止序列（参数被忽略）', 'output ran past the stop sequence (parameter ignored)'), evidence);
    if (ctx.adapter.kind === 'anthropic' && r.stopReason !== 'stop_sequence')
      return result(id, 'warn', title, l(`未越界，但 stop_reason=${r.rawStopReason}（应为 stop_sequence）`, `not exceeded, but stop_reason=${r.rawStopReason} (expected stop_sequence)`), evidence);
    return result(id, 'pass', title, l('在停止序列处正确截止', 'stopped at the stop sequence'), evidence);
  });
}

async function maxTokens(ctx: ProbeContext): Promise<CheckResult> {
  const id = 'protocol.max_tokens';
  const title = l('max_tokens 截断', 'max_tokens truncation');
  return guard(id, title, async () => {
    const limit = Math.max(ctx.adapter.minMaxTokens, 8);
    const r = await ctx.adapter.chat({ model: ctx.model, messages: [{ role: 'user', content: 'Write a 500-word essay about the history of bridges.' }], maxTokens: limit, temperature: 0, exactMaxTokens: true });
    const evidence = { limit, outputTokens: r.usage.output, stop: r.rawStopReason, text: r.text.slice(0, 120) };
    if (r.usage.output !== null && r.usage.output > limit + 2)
      return result(id, 'fail', title, l(`限制 ${limit}，却计费 ${r.usage.output} output token`, `limit ${limit} but billed ${r.usage.output} output tokens`), evidence);
    if (r.stopReason !== 'max_tokens')
      return result(id, 'warn', title, l(`stop_reason=${r.rawStopReason}（应为 max_tokens/length）`, `stop_reason=${r.rawStopReason} (expected max_tokens/length)`), evidence);
    return result(id, 'pass', title, l(`在 ${limit} token 处截断，stop_reason 正确`, `truncated at ${limit} tokens with the right stop_reason`), evidence);
  });
}

async function modelEcho(ctx: ProbeContext): Promise<CheckResult> {
  const id = 'protocol.model_echo';
  const title = l('model 字段回显', 'Response model field');
  return guard(id, title, async () => {
    const r = await ctx.adapter.chat({ model: ctx.model, messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 16, temperature: 0 });
    if (modelEchoMatches(ctx.model, r.model)) return result(id, 'pass', title, l(`回显 ${r.model}`, `echoed ${r.model}`), { requested: ctx.model, echoed: r.model });
    return result(id, 'warn', title, l(`请求 ${ctx.model}，响应却是 ${r.model ?? '（空）'}`, `requested ${ctx.model}, response says ${r.model ?? '(empty)'}`), { requested: ctx.model, echoed: r.model });
  });
}

async function thinking(ctx: ProbeContext): Promise<CheckResult> {
  const id = 'protocol.thinking';
  const title = l('thinking 块与签名', 'Thinking block & signature');
  if (!ctx.adapter.supportsThinking) return result(id, 'skip', title, l('仅 Anthropic 协议检查', 'Anthropic protocol only'));
  return guard(id, title, async () => {
    const r = await ctx.adapter.chat({ model: ctx.model, messages: [{ role: 'user', content: 'What is 17 * 23? Think it through, then answer with the number.' }], maxTokens: 2048, thinkingBudget: 1024 });
    const evidence = { blocks: r.thinking.length, hasSignature: r.thinking.map((t) => !!t.signature), answer: r.text.slice(0, 80) };
    if (!r.thinking.length) return result(id, 'warn', title, l('请求了 thinking 但没有返回 thinking 块（模型不支持或被中转剥离）', 'thinking requested but no thinking block returned (unsupported or stripped)'), evidence);
    if (r.thinking.some((t) => !t.signature)) return result(id, 'fail', title, l('thinking 块缺少 signature（多轮/工具场景会失败）', 'thinking block has no signature (multi-turn/tool use will break)'), evidence);
    return result(id, 'pass', title, l('thinking 块与 signature 均存在', 'thinking block and signature present'), evidence);
  });
}

export async function runProtocol(ctx: ProbeContext): Promise<GroupResult> {
  const results: CheckResult[] = [];
  for (const fn of [toolRoundTrip, sse, stopSequences, maxTokens, modelEcho, thinking]) {
    results.push(await fn(ctx));
    ctx.log(`protocol ${results.length}/6`);
  }
  const status = worstStatus(results.map((r) => r.status));
  const failed = results.filter((r) => r.status === 'fail').map((r) => r.id.replace('protocol.', ''));
  return {
    id: 'protocol',
    status,
    summary: status === 'fail' ? l(`协议不保真：${failed.join(', ')}`, `protocol broken: ${failed.join(', ')}`) : status === 'warn' ? l('协议存在小问题', 'minor protocol issues') : l('协议保真', 'protocol intact'),
    results,
    meta: { failed },
  };
}
