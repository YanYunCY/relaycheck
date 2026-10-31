export type ApiKind = 'anthropic' | 'openai' | 'responses';
export const API_KINDS: ApiKind[] = ['anthropic', 'openai', 'responses'];

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name?: string; content: string };

export interface Msg {
  role: 'user' | 'assistant';
  content: string | Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  system?: string;
  messages: Msg[];
  maxTokens: number;
  /** keep maxTokens exactly as given even for reasoning models (truncation probe) */
  exactMaxTokens?: boolean;
  temperature?: number;
  stop?: string[];
  tools?: ToolDef[];
  /** force a call to the named tool */
  toolChoice?: string;
  /** Anthropic extended thinking budget */
  thinkingBudget?: number;
  /** mark the system prompt as a cacheable prefix (Anthropic cache_control) */
  cacheSystem?: boolean;
}

export type StopReason = 'end' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'other';

export interface Usage {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export interface ChatResponse {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  thinking: { text: string; signature?: string }[];
  stopReason: StopReason;
  rawStopReason: string | null;
  model: string | null;
  usage: Usage;
  raw: unknown;
}

export interface StreamResult {
  events: string[];
  text: string;
  stopReason: StopReason;
  rawStopReason: string | null;
  model: string | null;
  usage: Usage;
  /** integrity problems found while parsing the SSE stream */
  problems: string[];
}

export interface AdapterOptions {
  baseUrl: string;
  key: string;
  timeoutMs: number;
  retries: number;
  /** OpenAI reasoning models (gpt-5, o-series): reasoning effort to request, e.g. minimal/low/none */
  reasoningEffort?: string;
}

export interface Adapter {
  kind: ApiKind;
  supportsStop: boolean;
  supportsThinking: boolean;
  /** minimum max_tokens the API accepts */
  minMaxTokens: number;
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream(req: ChatRequest): Promise<StreamResult>;
  /** exact upstream token count when the API offers it, otherwise null */
  countTokens(req: ChatRequest): Promise<number | null>;
}

export function messageText(m: Msg): string {
  if (typeof m.content === 'string') return m.content;
  return m.content
    .map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : ''))
    .filter(Boolean)
    .join('\n');
}

export function emptyUsage(): Usage {
  return { input: null, output: null, cacheRead: null, cacheWrite: null };
}

export function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}
