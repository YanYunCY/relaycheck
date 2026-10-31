import { AnthropicAdapter } from './anthropic.js';
import { HttpError } from './http.js';
import { OpenAIChatAdapter } from './openai.js';
import { ResponsesAdapter } from './responses.js';
import type { Adapter, AdapterOptions, ApiKind } from './types.js';

export function createAdapter(kind: ApiKind, o: AdapterOptions): Adapter {
  switch (kind) {
    case 'anthropic':
      return new AnthropicAdapter(o);
    case 'openai':
      return new OpenAIChatAdapter(o);
    case 'responses':
      return new ResponsesAdapter(o);
  }
}

/**
 * Probe the endpoint with a tiny request per protocol, in order
 * anthropic → openai chat → responses, and pick the first that answers in-shape.
 */
export async function detectApi(o: AdapterOptions, model: string): Promise<{ kind: ApiKind; tried: string[] }> {
  const tried: string[] = [];
  const quick = { ...o, retries: 0 };
  for (const kind of ['anthropic', 'openai', 'responses'] as ApiKind[]) {
    try {
      const r = await createAdapter(kind, quick).chat({
        model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        maxTokens: 16,
      });
      const raw = r.raw as any;
      const ok =
        (kind === 'anthropic' && raw?.type === 'message' && Array.isArray(raw?.content)) ||
        (kind === 'openai' && Array.isArray(raw?.choices)) ||
        (kind === 'responses' && (raw?.object === 'response' || Array.isArray(raw?.output)));
      if (ok) return { kind, tried };
      tried.push(`${kind}: unexpected response shape`);
    } catch (e) {
      tried.push(`${kind}: ${e instanceof HttpError ? `HTTP ${e.status}` : (e as Error).message}`);
    }
  }
  throw new Error(`could not detect API protocol (${tried.join('; ')}). Pass --api anthropic|openai|responses.`);
}
