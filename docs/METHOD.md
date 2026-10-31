# relaycheck: method, statistics and calibration

[English](METHOD.md) · [简体中文](METHOD.zh-CN.md)

This document explains what relaycheck tests, how it decides, how well the decision is calibrated on real data, and what it cannot detect. Every number below comes from experiments you can re-run (see [Reproduce](#reproduce)). relaycheck gives **evidence, not proof**.

## 1. Threat model

relaycheck takes the side of a paying customer who talks to a relay (proxy, gateway, reseller) and wants to know whether the relay serves what it claims. The relay controls every byte between you and the upstream model. We consider:

| Threat | What the relay does | Probe group that targets it |
|---|---|---|
| **Model swap** | Serves a cheaper or different model under the requested name, and rewrites the `model` field in the response | identity (statistical fingerprint); protocol `model_echo` only catches careless relays |
| **Quantized, older or fine-tuned variant** | Same family but different weights, e.g. a quantized open model or the previous snapshot | identity. Power depends on how far the answer distributions moved (see §5.3) |
| **Hidden prompt injection billed to you** | Adds a system prompt or instructions to every request and bills the extra input tokens | billing `hidden_tokens` (exact baseline), identity `tokenizer` |
| **Cache billing fraud** | Reports no cache hits (bills full price), or invents cache hits | billing `prompt_cache` |
| **Context truncation** | Silently drops the head, tail or middle of long prompts to save cost | context (needles at 10/50/90 % depth, 2k control, 32k, 100k with `--deep`) |
| **Protocol breakage** | Drops tool definitions or tool results, breaks SSE streams, ignores `stop`/`max_tokens`, strips thinking signatures | protocol |

Out of scope: a relay that *adapts to relaycheck* (detects our fixed prompts and routes only those to the genuine model). The probes are ordinary short requests, but a determined adversary can fingerprint them. See §7.

## 2. Identity: statistical fingerprint

### 2.1 Probes (probe set v2)

A probe is a finite-choice question asked at `temperature=1`, e.g. *"Pick a name for a kitten: Luna, Milo, Oliver, Leo, Bella, Max. Reply with only your choice, nothing else."* A model's answer frequencies on a fixed set of such probes are a behavioural fingerprint. Different models, and different snapshots of one model, prefer different answers.

Probe set **v2** (relaycheck 0.2) has **24 probes**, chosen from **46 candidates** that were screened on gpt-6-luna, gpt-5.6-luna, gpt-5-nano and gpt-5.4-nano (20 samples each, 3,839 requests):

- **Dropped** v1 probes that every screened model answers identically and that therefore carry no information: digit→7, colour→blue, letter→C, fruit→mango, 1–5→3, direction→north, coin→heads, instrument→piano, gem→sapphire. New candidates that were deterministic everywhere (1–10→7, chess→knight, city→Tokyo, bird→owl, weather→sunny…) were not added.
- **Kept** probes that are spread out on gpt-6-luna (high entropy, e.g. `letter10`, `zh_animal`, `continent`, `month`, `metal`, `coin3`), or that separate gpt-6-luna from a *same-family* model even when one side is nearly deterministic (`catname` Milo vs Luna, `animal_rev` fox vs owl, `planet` Mars vs Earth, `digit_not7` 4 vs 3, `flower`, `tree`, `dessert`).
- Two Chinese-language probes (`zh_animal`, `zh_color`) and one with word aliases (`card_rank`: "Ace", "Queen"…).

In the new 100-sample gpt-6-luna reference only 1 of 24 probes is deterministic (`card_rank`→7), against 6 of 16 in v1. In real runs 23 of 24 probes are informative.

Selection bias: probes were picked on the screening data, so the screening data overstate discrimination. All power numbers in §5 come from **fresh** samples collected after the selection.

### 2.2 Answer normalization

Free text is mapped to a label by `classify()` (src/probes/classify.ts):

- NFKC normalization (full-width `７` becomes `7`), lowercase, markdown, quotes and trailing punctuation stripped, lead-ins removed ("I'd pick", "Answer:", "我选").
- `<think>…</think>` blocks that some relays leak are removed. An *unterminated* `<think>` means no answer yet, so the label is `other`.
- Number words (`seven`, `七`) and per-probe aliases (`fall`→autumn, `蓝`→`blue` and the reverse, `Ace`→`A`).
- Single-character labels (letters, digits) match only as standalone tokens. Contractions are removed first: in relaycheck 0.1 "I'd go with C" was counted as **D**, and "a C" as **A**. An answer that names two different single-character labels is `other`, and so is long free text that only happens to contain a letter.
- CJK labels match by substring, because CJK text has no word boundaries.
- Anything else is the category `other`. It takes part in the test like any other answer, because a model that ignores the format is itself a signal.

### 2.3 Per-probe test

For each probe we have a 2 × K table: counts of the run under test (n = 24 by default) against the reference counts (100 by default). The statistic is Pearson's χ² for homogeneity. The p-value is a **Monte Carlo permutation p-value**. The pooled answers are re-split at random into groups of the original sizes, which holds the margins fixed like the Fisher–Freeman–Halton exact test. This is valid at any sample size and any sparsity, and it accounts for the reference's own sampling noise.

- **Sequential stopping** (Besag & Clifford 1991): simulation stops after 40 simulated statistics reach the observed one, or after 20,000 tables. If none reaches it, the floor is pushed down with 200,000 more tables. Strong signals then stay cheap and weak signals get resolved.
- **Mid-p**: tables that tie the observed statistic count half. Near-one-hot answer distributions make χ² extremely discrete, and the ordinary p-value is then very conservative (§4.1).
- **Floor and asymptotic tail**: if no simulated table reaches the observed one, the p-value is the MC floor 1/(L+1). The asymptotic χ² tail is used below the floor only for dense tables (Cochran's rule: every expected count ≥ 1 and ≥ 80 % of them ≥ 5). In 0.1 the tail was used whenever MC hit its floor. For sparse tables that tail is badly anti-conservative.
- Probes with df = 0 (both sides gave the same single answer) carry no evidence and are dropped.

### 2.4 Over-dispersion correction

Real endpoints are not perfectly independent draws. We collected 20 time blocks × 24 official gpt-6-luna samples per probe (§4.2). Answer counts vary between blocks more than a multinomial allows: the pooled dispersion is **φ̂ = Σχ²/Σdf = 1.098** (Σdf = 836, asymptotic p = 0.025). Possible causes are batching and serving-replica effects.

That sounds small, but it matters. In simulation with φ = 1.1 and no correction, the warn-level false-positive rate doubles to 1.95 %. With φ = 1.3 the fail-level rate rises 5.5× to 0.55 % (§4.1). relaycheck therefore divides each probe's χ² by max(1, φ). This is the quasi-likelihood correction. φ is stored in the reference:

- `relaycheck fingerprint` samples the reference in 4 interleaved time blocks and stores the between-block estimate.
- `refs/gpt-6-luna.json` carries φ = 1.098, estimated from the 20 extra official blocks.

The cap is 2. The correction makes the test somewhat conservative, because tied tables now count as exceedances.

### 2.5 Combination and verdict

Per-probe p-values are merged with the **Cauchy combination test** (Liu & Xie 2020), T = Σ wᵢ tan((0.5 − pᵢ)π), with equal weights and pᵢ truncated at 0.99. It is robust to dependence between probes and is dominated by the strongest signals. A single probe at the MC floor (5·10⁻⁶) among 24 is enough to fail.

| combined p | identity status |
|---|---|
| < 0.001 | **fail**: answer distributions differ from the reference |
| < 0.01 | **warn**: mild deviation, re-run with more `--samples` |
| otherwise | **pass** |

A pass where more than 20 % of the sample requests failed becomes warn. Failed requests are excluded from the counts. A relay that errors selectively on some answers would bias the test, so the error rate is reported.

### 2.6 Reference compatibility

References now record `probeSetVersion`, `sampling` (protocol, temperature, max tokens, reasoning effort), `dispersion` and `billing` baselines. A check:

- **refuses** a reference from an unknown probe-set version, and any reference whose prompts differ from the definitions of its version (edited or foreign file);
- **accepts** an old v1 reference with its own probe definitions, plus a warning that it discriminates less;
- **warns** when the reasoning effort differs from the reference. A different effort really changes the answer distributions, which is a false-alarm risk. A protocol difference (Chat vs Responses) is reported as a note.

### 2.7 Heuristics (not used for the verdict unless noted)

Self-report ("which model are you?") is **info** unless the answer names another vendor's family, which gives **warn**. Genuine gpt-6-luna answers "GPT-5.2 Thinking", and gpt-5.6-luna answers "OpenAI o3". A misnamed but same-vendor self-report must not make an honest relay *inconclusive*. Knowledge cutoff is info. The **tokenizer** check compares the input tokens billed for a fixed mixed-script text with the official count stored in the reference.

## 3. Billing

### 3.1 Hidden injected tokens: exact baseline

In 0.1 the OpenAI side compared billed `usage.input_tokens` with a ~4 chars/token estimate. It could only see injections of more than ~200 tokens. 0.2 makes it exact:

- At fingerprint time, the **trusted** endpoint is sent 4 fixed prompts (3 lengths of a fixed paragraph plus the tokenizer text), each twice. The official `usage.input_tokens` is stored per protocol, and refused if the two repeats differ. Both Chat Completions and Responses are measured for OpenAI. For gpt-6-luna they are identical: b1 = 80, b4 = 257, b12 = 729, tokenizer = 74.
- At check time the same prompts are sent to the relay, and the billed counts are compared with the baseline:
  - all |excess| < 4 → **pass** ("matches exactly");
  - the same excess on every length (spread ≤ max(3, 2 %)) → a hidden per-request prompt: **fail** at ≥ 16 tokens, **warn** at 4–15;
  - excess that grows with prompt length (slope ≠ 1) → **warn**, different tokenizer, likely a different model family;
  - billed fewer than official → **warn**, prompt rewritten or truncated.
- The baseline is used only when the reference is for the same model, the protocol matches and the prompt hashes match. Otherwise the check falls back to Anthropic `count_tokens` (exact) or the local estimate, and is labelled **UNCALIBRATED** in the report. Anthropic references get the same baseline. This covers relays that do not offer `count_tokens`.

Real check: the official API matched exactly (diff 0 on all three prompts). A local relay that prepends a 37-word hidden system prompt to every request was caught. See §5.4.

### 3.2 Prompt cache

The check sends a ≈5k-token prefix with a fresh random session id twice. If the second request shows no hit, it sends a third after 1.5 s, because OpenAI caching is best effort and depends on routing. Results:

- no hit → warn;
- a hit on the *first* request of a never-seen random prefix → warn, cache accounting not trustworthy;
- cached > prompt → fail;
- Anthropic: a cache hit but `input_tokens` still full → fail (double billing).

Official gpt-6-luna read 3,810 cached tokens (~76 % of the prompt) on the second call.

## 4. Calibration: false positives

### 4.1 Simulation (no API calls)

`scripts/calibrate-sim.ts` runs the shipped scoring code on simulated data. The reference ~ Mult(100, P) in 4 blocks, the test ~ Mult(24, P), and P is the real gpt-6-luna reference unless noted. Rates are given with exact 95 % Clopper–Pearson intervals. Nominal levels are 0.1 % (fail) and 1 % (warn).

| setting | sims | p < 0.001 (fail) | p < 0.01 (warn or worse) | p < 0.05 |
|---|---|---|---|---|
| **shipped**: permutation, mid-p, φ correction, data with φ = 1.098 | 4,000 | **0.050 %** [0.006, 0.18] | **0.80 %** [0.55, 1.13] | 2.6 % |
| permutation + mid-p, independent data (φ = 1) | 10,000 | 0.040 % [0.011, 0.10] | 0.87 % [0.70, 1.07] | 4.4 % |
| same, sparse random truths (Dirichlet α = 0.3) | 5,000 | 0.060 % [0.012, 0.18] | 0.80 % [0.57, 1.09] | 4.4 % |
| same, v1 reference as truth | 10,000 | 0.040 % [0.011, 0.10] | 0.61 % [0.47, 0.78] | 4.1 % |
| same, n = 12 samples per probe | 2,500 | 0.080 % [0.010, 0.29] | 1.24 % [0.84, 1.75] | 4.6 % |
| shipped, n = 12 | 2,000 | 0.000 % [0, 0.18] | 0.45 % [0.21, 0.85] | 1.5 % |
| permutation + mid-p, n = 48 | 2,500 | 0.040 % [0.001, 0.22] | 0.88 % [0.55, 1.33] | 4.4 % |
| permutation **without** mid-p (strictly conservative), v1 truth | 10,000 | 0.000 % [0, 0.037] | 0.24 % | 1.2 % |
| over-dispersed φ = 1.1, **no** correction | 4,000 | 0.050 % | **1.95 %** [1.54, 2.43] | 8.2 % |
| over-dispersed φ = 1.1, corrected | 4,000 | 0.025 % | 0.70 % | 2.9 % |
| over-dispersed φ = 1.3, **no** correction | 4,000 | **0.55 %** [0.35, 0.83] | 4.20 % | 18.2 % |
| over-dispersed φ = 1.3, corrected | 4,000 | 0.175 % [0.07, 0.36] | 1.27 % | 4.1 % |
| 0.1 method (parametric bootstrap), sparse truths | 4,000 | 0.10 % | 1.15 % | 5.6 % |

Conclusions:

- The shipped test is at or below nominal level for the default 24 samples.
- Mid-p is needed. Without it the test throws away most of its size and power.
- The over-dispersion correction is what keeps real-endpoint false-alarm rates nominal.
- With 12 samples and no correction, the warn level runs slightly above nominal (1.24 %). With the shipped correction at 12 samples it is 0.45 % (fail level 0 %, 2,000 simulations).

### 4.2 Real false-positive experiment (official gpt-6-luna)

- **Reference**: `refs/gpt-6-luna.json`, probe set v2, 100 samples × 24 probes via the official Responses API (`--reasoning-effort none`), 2,416 requests.
- **Null runs**: 20 independent identity-only runs × 24 samples × 24 probes (**11,520 requests**). They were collected after the reference and interleaved in time like real CLI runs, then scored exactly as the CLI does (`scripts/analyze-real.ts`).

| | fail (p < 0.001) | warn (p < 0.01) | pass | min p | median p |
|---|---|---|---|---|---|
| shipped (φ = 1.098) | **0 / 20** | **0 / 20** | 20 / 20 | 0.105 | 0.93 |
| without dispersion correction | 0 / 20 | 0 / 20 | 20 / 20 | 0.031 | 0.27 |

- 0 / 20 bounds the real false-alarm rate only loosely: the 95 % upper bound is 13.9 %. The simulation above carries the precision.
- At probe level, 480 tests gave 5.6 % below 0.05, 0.4 % below 0.01 and 0 below 0.001 with the correction (6.9 %, 1.7 % and 0 without it).
- Two more official runs: the full CLI run (all groups plus `--deep`) gave p = 0.722, and the 20-sample screening batch gave p = 0.95.
- **Drift check**: the pooled 480 fresh samples per probe against the 100-sample reference show no probe below p = 0.02 out of 24. There is no evidence of drift over the roughly one hour of the experiment. The φ estimate in that window was 1.098. One probe (`flower`) showed significant within-run clustering (permutation p = 0.009).

## 5. Power: catching a different model

### 5.1 Real runs: other models claimed as gpt-6-luna

Fresh samples of each model, scored against the gpt-6-luna reference, 24 samples × 24 probes per run:

| model served | runs | caught (fail) | combined p (median, max) | most different probes |
|---|---|---|---|---|
| gpt-5.6-luna (same family) | 10 | **10 / 10** | 6.9·10⁻¹⁵, 2.6·10⁻¹⁴ | planet, digit_not7, catname |
| gpt-5-nano | 5 | **5 / 5** | 1.8·10⁻¹⁸, 1.7·10⁻¹⁴ | tree, planet, shape, animal_rev |
| gpt-5.4-nano | 5 | **5 / 5** | 4.2·10⁻¹⁷, 1.9·10⁻¹⁶ | daytime, animal_rev, flower, catname |

End-to-end with the CLI: a local dishonest relay received `model=gpt-6-luna`, called gpt-5.6-luna upstream and rewrote the `model` field back to gpt-6-luna. relaycheck reported **INCONSISTENT, p = 7.2·10⁻¹⁵**, exit 1. Protocol, billing (same tokenizer, exact token match), prompt cache and the 32k context check all passed, and the `model` echo looked right. Only the fingerprint caught the swap.

### 5.2 Partial swaps (simulation)

A relay that forwards to the genuine model a fraction *w* of the time and to gpt-5.6-luna otherwise is simulated with the real answer distributions of both models (shipped configuration, 500 simulations each, MC floor 5·10⁻⁵, which can only understate power):

| genuine share w | 0 | 0.5 | 0.7 | 0.8 | 0.9 |
|---|---|---|---|---|---|
| P(fail), 24 samples | 100 % | 99.6 % | 44.6 % | 7.8 % | 0.2 % |
| P(warn or fail) | 100 % | 100 % | 93.6 % | 55.2 % | 9.2 % |

Other substitutes, same simulation. Each cell is P(fail) / P(warn or fail) at 24 samples:

| substitute | w = 0 | 0.5 | 0.7 | 0.8 | 0.9 |
|---|---|---|---|---|---|
| gpt-5.6-luna | 100 / 100 % | 99.6 / 100 % | 44.6 / 93.6 % | 7.8 / 55.2 % | 0.2 / 9.2 % |
| gpt-5-nano | 100 / 100 % | 100 / 100 % | 99.4 / 100 % | 59.8 / 98.4 % | 1.8 / 35.2 % |
| gpt-5.4-nano | 100 / 100 % | 100 / 100 % | 85.0 / 99.6 % | 25.0 / 83.4 % | 1.0 / 19.6 % |

Samples per probe, gpt-5.6-luna substitute. Each cell is P(fail) / P(warn or fail):

| `--samples` | 6 | 12 | 24 (default) | 48 |
|---|---|---|---|---|
| full swap (w = 0) | 100 / 100 % | 100 / 100 % | 100 / 100 % | 100 / 100 % |
| 80 % genuine (w = 0.8) | 0 / 12.0 % | 1.0 / 25.2 % | 7.8 / 55.2 % | 26.4 / 77.0 % |

A full swap to any of the three models is caught even with 6 samples per probe. Partial swaps need many more samples.

### 5.3 What drives power

Power comes from probes where the models' favourite answers differ. Same-family models differ on fewer probes than different families, but on gpt-5.6-luna vs gpt-6-luna several probes flip completely (Mars→Earth, Milo→Luna, 4→3), so single runs are already decisive. A quantized copy of the *same* weights usually shifts probabilities only slightly. That shows up as small effect sizes, as in the w ≈ 0.8–0.9 columns, and needs larger `--samples`.

### 5.4 Hidden prompt injection (real)

A local proxy in front of the official API prepended a 37-word hidden system instruction to every gpt-6-luna request. relaycheck (`--probes identity,billing`) reported **INCONSISTENT: +37 hidden input tokens per request**. The same excess appeared on all three baseline prompts, which is how the check tells a constant per-request prompt from a different tokenizer. The tokenizer check showed 111 billed tokens against the official 74. The identity fingerprint also moved to p = 0.001 (warn): the hidden instructions change answer distributions too, mostly on `sport` and `metal`.

## 6. Context probe

Each document holds three passphrases at 10 %, 50 % and 90 % depth. Head-only, tail-only and middle-out truncation then all lose at least one. The documents are a 2k control, 32k and, with `--deep`, 100k (approximate sizes, ~4 chars/token). Matching tolerates case, markdown and Unicode dashes. False positives are avoided in two ways:

- an answer cut off by `max_tokens` (reasoning models spend the budget) or an empty answer is **inconclusive**, not truncation;
- a miss is re-tested with fresh passphrases. Truncation repeats at the same depth, while a recall slip does not. Only a repeat miss at the same depth is a **fail**.

Official gpt-6-luna recalled all needles at 2k, 32k and 100k (billed 2,181, 33,487 and 104,474 input tokens).

## 7. Limitations: what relaycheck cannot tell you

- **Mostly-genuine relays.** A relay that serves the genuine model ≥ 80 % of the time is usually not caught at 24 samples (P(fail) 7.8 % at w = 0.8, §5.2). Neither is one that only swaps at busy hours, or only for long or expensive requests. Raise `--samples`, re-run at different times, and treat a single pass as weak evidence.
- **Adaptive adversaries.** The probes and billing prompts are public and fixed. A relay that recognises them can route only them to the genuine model. Randomising probe wording would cost calibration, and that is future work.
- **Vendor updates and drift.** A provider can update a model behind the same name. The fingerprint will then flag the *official* endpoint too. Regenerate references from a trusted endpoint, and check the reference date. Within our ~1 h experiment we saw no drift, but we have not measured drift over days or weeks.
- **Same-family and same-weights variants.** Closely related snapshots, quantized copies and light fine-tunes can sit within the reference's sampling noise. A pass means "not distinguishable at this sample size", not "identical weights".
- **Sampling settings.** Reasoning effort, system prompts or temperature defaults that differ from the reference change the distributions. relaycheck warns about the settings it can see, but a relay can change hidden defaults.
- **Calibration scope.** The real false-positive numbers come from one model (gpt-6-luna), one protocol (Responses), one hour, 20 runs. The simulation shows nominal size under multinomial and moderately over-dispersed models. Real endpoints with larger or time-varying dispersion would raise false alarms. The 0.001 fail threshold leaves margin.
- **Billing.** The exact baseline catches a constant hidden prompt down to a few tokens, but only for prompts that match the reference, model and protocol. A relay can inject only into longer or tool-carrying requests, or bill honestly while doing something else. Cache checks depend on the upstream's best-effort caching.
- **Context.** Three needles at 32k/100k cannot locate an exact window, and a relay could truncate only above 100k.
- Self-reports, knowledge cutoffs and the `model` field are trivially forged and are never used as proof.

## Reproduce

Everything below except the API runs is free, and none of it is part of `npm test`, which uses mocks only.

```bash
npm install && npm run build && npm test

# real API (OpenAI key in RELAY_KEY); costs are approximate, at gpt-6-luna prices
RELAY_KEY=... node dist/cli.js fingerprint https://api.openai.com --model gpt-6-luna --api responses \
  --reasoning-effort none --samples 100 --out refs/gpt-6-luna.json          # 2,416 requests, ≈ $0.015
RELAY_KEY=... npx vite-node scripts/collect.ts -- fpr gpt-6-luna 480 current 24 24   # 11,520 requests, ≈ $0.07
RELAY_KEY=... npx vite-node scripts/collect.ts -- power gpt-5.6-luna 240 current 24 16
npx vite-node scripts/analyze-real.ts -- --ref refs/gpt-6-luna.json --raw calib/raw/fpr-gpt-6-luna.jsonl
npx vite-node scripts/drift.ts -- --raw calib/raw/fpr-gpt-6-luna.jsonl          # dispersion and drift diagnostics
npx vite-node scripts/set-dispersion.ts -- --ref refs/gpt-6-luna.json --raw calib/raw/fpr-gpt-6-luna.jsonl --write

# simulations (no API)
sh scripts/sim-batch.sh; sh scripts/sim-batch2.sh; sh scripts/sim-batch3.sh; python3 scripts/summarize-sim.py

# end-to-end against a deliberately dishonest local relay
NODE_USE_ENV_PROXY=1 node scripts/dishonest-proxy.mjs --port 18990 --swap-to gpt-5.6-luna &
RELAY_KEY=... node dist/cli.js http://127.0.0.1:18990 --model gpt-6-luna --api responses --reasoning-effort none
```

Raw answers (`calib/raw/*.jsonl`) keep the model's literal text, so answer normalization can be re-done offline at no cost.

## References

- Besag, J. & Clifford, P. (1991). Sequential Monte Carlo p-values. *Biometrika* 78(2).
- Liu, Y. & Xie, J. (2020). Cauchy combination test. *JASA* 115(529).
- Lancaster, H. O. (1961). Significance tests in discrete distributions (mid-p). *JASA* 56.
- McCullagh, P. & Nelder, J. (1989). *Generalized Linear Models*, quasi-likelihood dispersion.
- DFA (arXiv 2610.37086), API-TAIL (arXiv 2610.36801), KBF (arXiv 2605.29524).
