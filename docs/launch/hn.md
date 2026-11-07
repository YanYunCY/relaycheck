# Show HN (scheduled 2026-11-10 22:30 CST = 09:30 EST)

## Title (≤80 chars)
Show HN: Relaycheck – test whether an LLM API relay serves the model it claims

## URL
https://github.com/YanYunCY/relaycheck

## Text
A lot of developers, especially in China, can't reach the official Claude or OpenAI APIs directly, so they run Claude Code and Codex through third-party relays. Some relays quietly swap in a cheaper model, inject hidden system prompts you pay for, or cut long context. A CISPA audit this year (arXiv 2603.01919) found 11 of 24 shadow-API endpoints failing fingerprint checks. "It feels dumber today" isn't evidence, so I built a CLI that gives you a p-value instead.

  npx relaycheck https://relay.example.com --model gpt-6-luna

How it works:

- Identity: 24 finite-choice probes ("pick a digit", "name a planet"), each sampled 24 times at temperature 1. Each answer distribution is compared with a reference fingerprint taken from the official API (permutation chi-squared test, over-dispersion corrected), then combined into one p-value with the Cauchy combination test. This follows the DFA paper (arXiv 2610.37086).
- Billing: reported usage is compared with the official token counts stored in the reference, so a hidden injected prompt shows up to the token.
- Protocol: tool-use round trip, SSE event order, stop sequences, max_tokens truncation, model echo.
- Context: needles at 10/50/90% depth in a 2k control and a 32k document (100k with --deep).

A default run is about 590 short requests and 65k input tokens, a few minutes, and under a cent on gpt-6-luna.

What I measured against the official OpenAI API (about $3.6 of calls in total, raw output in the repo):

- No false alarms on the real thing: 20/20 repeated gpt-6-luna checks and 7/7 checks across four other models came back consistent.
- gpt-6-luna served under other model names: 7/7 caught, p ≤ 1.2e-5.
- A local proxy that served gpt-5.6-luna and rewrote the model field: caught, p = 7.2e-15, while protocol, billing and context all looked clean.
- A short hidden system prompt: caught as +37 input tokens per request.
- A blind spot: gpt-6.1-sol served as gpt-6-astra passed (p = 0.024). Their answers are almost identical, so sampling probes can't separate them yet. That's in docs/METHOD.md, with the other things it can't see: a relay that serves the real model most of the time, or one that recognises the fixed probes.
- Another catch: the references were sampled over the Responses API, and the same official model drifts over Chat Completions (p down to 1e-4 in 5 runs). So luna, terra and sol now also ship Chat Completions references, picked by protocol; for the other models, across protocols relaycheck only calls a swap on a very strong signal and otherwise says inconclusive.

TypeScript, zero dependencies, MIT. Your key is read only from an env var and goes only to the endpoint you test. There's a mock relay so you can try it without a key.

There are 5 GPT references so far and no Claude ones, because I only have an OpenAI key; without a reference the identity test is inconclusive. If you have an official Anthropic key, `relaycheck fingerprint` builds one for about a dollar of API calls, and a PR would help a lot. I'd also love ideas for a probe that can tell two near-identical models apart.
