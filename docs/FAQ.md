# FAQ

**Why should I trust the verdict?**
It doesn't rely on the model naming itself (trivially faked). It asks 24 short questions 24 times each and tests whether the answer distribution comes from the same model as an official reference fingerprint, using permutation tests combined with the Cauchy method. On the official gpt-6-luna, 20 independent self-checks were all consistent; gpt-5.6-luna, gpt-5-nano and gpt-5.4-nano posing as gpt-6-luna were caught in 20 of 20 runs, with p-values around 1e-15. Method and raw data are in [METHOD.md](METHOD.md), reproducible.

**What if I get a false positive?**
Check that the reference is the same model and reasoning effort, that the vendor hasn't just updated the model (that flags the official endpoint too), and that you used enough samples (`--samples 48` is steadier). Still wrong? Open an issue with the JSON report (redacted by default). "Inconclusive" (exit 2) means not enough evidence, not an accusation.

**Why no leaderboard of good and bad relays?**
One run reflects one moment, one model, one route; a relay can be genuine part of the time or differ per user. A name-and-shame list wouldn't be rigorous. relaycheck gives you evidence; you decide what to share, and share cards hide the host by default.

**Is my key safe?**
The key is read only from an environment variable and sent only to the URL you give. No third-party server is involved. Keys, URL credentials and cookies are redacted from reports and logs. Zero runtime dependencies, easy to audit.

**How much does a run cost?**
By default about 600 very short requests plus a few context requests: under one cent on a cheap model like gpt-6-luna, proportionally more on expensive ones. `--deep` (100k-token context) costs noticeably more; opt in.

**What can't it catch?**
A relay that serves the genuine model most of the time (80 % genuine is flagged only 7.8 % of the time at 24 samples); a relay that recognises the fixed probes and routes only those to the real model; near-identical variants of the same model. See the limitations in [METHOD.md](METHOD.md).

**Which models and protocols?**
Anthropic Messages, OpenAI Chat Completions and OpenAI Responses. Identity testing needs a reference fingerprint for the model; gpt-6-luna ships built in. Generate others with an official key (`relaycheck fingerprint`) and send a PR to `refs/`.
