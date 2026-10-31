/**
 * Rough, tokenizer-free token estimator: ~4 chars/token for Latin text,
 * ~1 token per CJK character. Good enough to spot hundreds of hidden tokens,
 * not good enough for exact accounting (we prefer count_tokens when available).
 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff)) cjk++;
    else other++;
  }
  return Math.ceil(other / 4 + cjk);
}

/** Per-message framing overhead used by both the client estimate and the mock. */
export const MESSAGE_OVERHEAD = 4;
export const PROMPT_OVERHEAD = 3;

export function estimatePromptTokens(system: string | undefined, messageTexts: string[]): number {
  let n = PROMPT_OVERHEAD;
  if (system) n += estimateTokens(system) + MESSAGE_OVERHEAD;
  for (const t of messageTexts) n += estimateTokens(t) + MESSAGE_OVERHEAD;
  return n;
}
