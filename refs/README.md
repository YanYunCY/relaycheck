# Reference fingerprints / 参考指纹

Format (relaycheck 0.2):

```
{ model, api, created, samples,
  probeSetVersion,                       // identity probe set (missing = 1, relaycheck 0.1)
  sampling: { api, temperature, maxTokens, reasoningEffort? },
  dispersion?: { phi, df, blocks, source },   // over-dispersion of the trusted endpoint (φ ≥ 1 used)
  probes: [{ id, prompt, dist: { label: count } }],
  billing?: { <api>: { prompts: [{ id, hash, inputTokens }], measuredAt } },  // exact usage baselines
  synthetic?, note? }
```

| file | what |
|---|---|
| `gpt-6-luna.json` | **REAL**: official OpenAI API, Responses protocol, `--reasoning-effort none`, probe set v2, 100 samples × 24 probes (2,416 requests, 2026-10-31). `dispersion.phi = 1.098` was estimated from 20 extra official time blocks (see docs/METHOD.md §2.4). Billing baselines for `responses` and `openai` (chat). |
| `gpt-6.1-sol.json` | **REAL**: official API, Responses, `--reasoning-effort low` (sol has no `none`), probe set v2, 100 × 24 (2,408 requests, 2026-10-31). φ from 4 fingerprint time blocks. |
| `gpt-6.1-terra.json` | **REAL**: official API, Responses, `--reasoning-effort none`, probe set v2, 100 × 24 (2,410 requests, 2026-10-31). |
| `gpt-6-astra.json` | **REAL**: official API, Responses, `--reasoning-effort low`, probe set v2, 100 × 24 (2,416 requests, 2026-10-31). Note: nearly indistinguishable from gpt-6.1-sol by sampling (see README limits). |
| `gpt-5.3-codex.json` | **REAL**: official API, Responses only (no Chat Completions for this model), `--reasoning-effort none`, probe set v2, 100 × 24 (2,400 requests, 2026-10-31). |
| `mock-honest.json` | **SYNTHETIC**: 200 samples/probe from the local mock `honest` relay over the Anthropic protocol (`model: mock-sonnet`). |
| `mock-honest-openai.json` | **SYNTHETIC**: same distribution, sampled over the OpenAI Chat protocol. |

The mock files describe no real model. They exist so the demo and tests run with no keys. Regenerate them with `npm run refs`.

To make a real reference, use an endpoint you trust (e.g. the official API) and the same `--api` / `--reasoning-effort` you will check with:

```
RELAY_KEY=... npx relaycheck fingerprint https://api.openai.com --model <model> --api responses --samples 100 --out refs/<model>.json
```

References from relaycheck 0.1 (probe set v1, 16 probes) still load, with a warning to regenerate them. A reference whose prompts do not match its probe-set version is rejected.
