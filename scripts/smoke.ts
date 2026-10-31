import { flushSpend, meteredAdapter, spendSoFar } from './lib.js';
for (const m of ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5-nano', 'gpt-5.4-nano']) {
  const a = meteredAdapter(m, 'smoke');
  try {
    const r = await a.chat({ model: m, messages: [{ role: 'user', content: 'Pick a random digit from 0 to 9. Reply with only your choice, nothing else.' }], maxTokens: 16, temperature: 1 });
    console.log(m, JSON.stringify(r.text), r.usage, r.model, (r.raw as any)?.usage?.output_tokens_details);
  } catch (e) { console.log(m, 'ERR', (e as Error).message.slice(0, 300)); }
}
flushSpend('smoke');
console.log(spendSoFar());
