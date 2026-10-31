/**
 * Map a free-text answer onto a finite label set.
 *
 * Robust to: case, NFKC width variants (７ → 7), markdown/quotes, trailing punctuation,
 * lead-ins ("I'd pick C", "Answer: blue"), <think>…</think> blocks some relays leak,
 * number words (seven / 七), user-supplied aliases (fall → autumn, 蓝 → blue) and
 * CJK labels (no word boundaries).
 *
 * Single-character labels (letters/digits) are only matched as standalone tokens and an
 * answer naming two different single-char labels is 'other' (ambiguous) — "I'd go with C"
 * must not count as "d", "a C" must not count as "a".
 */
export const OTHER = 'other';

const NUMBER_WORDS: Record<string, string[]> = {
  '0': ['zero', '零', '〇'],
  '1': ['one', '一'],
  '2': ['two', '二', '两'],
  '3': ['three', '三'],
  '4': ['four', '四'],
  '5': ['five', '五'],
  '6': ['six', '六'],
  '7': ['seven', '七'],
  '8': ['eight', '八'],
  '9': ['nine', '九'],
  '10': ['ten', '十'],
  '11': ['eleven', '十一'],
  '12': ['twelve', '十二'],
};

const CJK = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
const LEAD_IN =
  /^(?:(?:my\s+)?(?:final\s+)?(?:answer|choice|pick|selection|guess)\s*(?:is)?\s*[:：\-–]?\s*|(?:i(?:'d|’d| would| will|'ll|’ll)?|let'?s)\s+(?:pick|choose|select|go\s+with|say|take)\s*[:：\-–]?\s*|(?:答案|我选|选择|我的选择)\s*(?:是)?\s*[:：]?\s*)/;

export function normalizeAnswer(text: string): string {
  let t = (text ?? '').normalize('NFKC');
  t = t.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, ' ');
  t = t.replace(/<think(?:ing)?>[\s\S]*$/i, ' '); // unterminated reasoning: no answer yet
  t = t.toLowerCase();
  t = t.replace(/[*_`~#>|]+/g, ' ');
  t = t.replace(/["“”„«»「」『』《》【】]/g, ' ');
  t = t.replace(/(^|\s)['‘’]+|['‘’]+(?=\s|$|[.,!?;:。，！？；：])/g, '$1');
  t = t.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) t = t.replace(LEAD_IN, '').trim();
  t = t.replace(/[\s.,!?;:。，！？；：…、]+$/u, '').replace(/^[\s.,!?;:。，！？；：…、(（\[]+/u, '').replace(/[)）\]]+$/u, '');
  return t.trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** earliest whole-token index of `needle` in `hay` (Unicode-aware boundaries), or -1 */
function wordIndex(hay: string, needle: string): number {
  if (CJK.test(needle)) return hay.indexOf(needle);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(needle)}(?=$|[^\\p{L}\\p{N}])`, 'u');
  const m = re.exec(hay);
  return m ? m.index + m[1].length : -1;
}

export function classify(labels: string[], text: string, aliases: Record<string, string[]> = {}): string {
  const t = normalizeAnswer(text);
  if (!t) return OTHER;
  // surface forms → label
  const forms: { form: string; label: string; exactOnly: boolean }[] = [];
  for (const lab of labels) {
    forms.push({ form: lab.toLowerCase(), label: lab, exactOnly: false });
    for (const a of aliases[lab] ?? []) forms.push({ form: a.toLowerCase().normalize('NFKC'), label: lab, exactOnly: false });
    for (const w of NUMBER_WORDS[lab] ?? []) forms.push({ form: w, label: lab, exactOnly: CJK.test(w) });
  }
  // 1. the whole answer is a label / alias
  for (const f of forms) if (t === f.form) return f.label;
  // drop English contractions so "i'd" does not yield the label "d"
  const u = t.replace(/(\p{L})['’](d|ll|m|s|t|re|ve)\b/gu, '$1');
  // 2. single-char labels: standalone tokens only, must be unambiguous
  const short = forms.filter((f) => f.form.length === 1 && !CJK.test(f.form));
  const long = forms.filter((f) => !(f.form.length === 1 && !CJK.test(f.form)) && !f.exactOnly);
  let best: string | null = null;
  let bestIdx = Infinity;
  let bestLen = 0;
  for (const f of long) {
    const i = wordIndex(u, f.form);
    if (i < 0) continue;
    // earliest mention wins; at the same position the longer form wins ("ice cream" over "ice")
    if (i < bestIdx || (i === bestIdx && f.form.length > bestLen)) {
      bestIdx = i;
      bestLen = f.form.length;
      best = f.label;
    }
  }
  if (best !== null) return best;
  if (short.length) {
    const tokens = u.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    let hits = [...new Set(tokens.filter((tok) => short.some((f) => f.form === tok)))];
    // "a" / "i" are also English words: drop them when another label token is present
    if (hits.length > 1) hits = hits.filter((h) => h !== 'a' && h !== 'i');
    if (hits.length === 1) {
      // reject long free text that merely contains the token ("a dog ran" for letter probes)
      if (tokens.length <= 4 || /^(letter|digit|number|option)$/.test(tokens[tokens.indexOf(hits[0]) - 1] ?? '')) return short.find((f) => f.form === hits[0])!.label;
    }
  }
  return OTHER;
}
