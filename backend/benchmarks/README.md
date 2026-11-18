# Reproducible local/cloud evaluation

Run from the repository root:

```bash
BENCH_LOCAL_MODELS=llama3:latest,qwen3:4b npm run benchmark --prefix backend
```

Start Ollama first. Models must already be installed; the runner never downloads them. The CLI deliberately does not read `backend/.env`. Set model URL with a literal loopback address if needed. Results are written to `backend/benchmarks/results/` (JSON request-level measurements, model availability, and a Markdown report). Real email, task and credential files are never loaded. Do not replace the synthetic fixtures with personal data.

For the cloud comparison, export `OPENAI_API_KEY`, `BENCH_CLOUD_MODEL`, `BENCH_INPUT_USD_PER_MILLION`, `BENCH_OUTPUT_USD_PER_MILLION`, and `BENCH_PRICING_SOURCE` in your terminal, then add `-- --cloud` to the command. Use the exact model identifier and current standard input/output rates from your provider account. The [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) documents the structured-output and token-limit fields used here. No model or pricing is silently selected.

The runner reserves the UTF-8 serialized request size plus a 4096-token overhead allowance at the supplied input price, plus the maximum 2048 completion tokens at the output price. Requests are sequential; failed requests retain their reservation; no retries are automatic. Dispatch stops before $5 of estimated reservations. This conservative bound assumes the declared model uses the supplied token rates. Inspect your account's billing controls as well. Set a fresh output location/copy results if preserving multiple runs: a new run replaces `latest.json` and `REPORT.md`.

## Method and limits

- Fixture version 1 generates 30 email and 30 scheduling cases with expected category, action count, duration, deadline and uncertainty labels. Cases include a malicious instruction, missing dates, and impossible duration/window combinations. Repeated templates intentionally provide a regression baseline, not a broad real-world corpus.
- One separate warm-up followed by three passes per provider. Identical prompts, synthetic clock, timezone and grammar; local temperature is zero, cloud uses its provider default. Local output cap and cloud completion cap are both 2048, but reasoning and sampling implementations can differ.
- Metrics include valid schema/evidence, category accuracy, action count, duration, deadline and uncertainty accuracy; output tokens/characters, per-request latency, cost and planner overlap/deadline/buffer violations. Failed requests remain in quality denominators. Inspect raw JSON for the detailed metrics beyond the report table.
- All extracted tasks use the same deterministic planner. Zero constraint violations alone does not establish extraction quality. Unschedulable tasks are an acceptable result for impossible windows, not permission to break a deadline.
- Latency is end-to-end, including transport and validation/planning; no time-to-first-token claim. Token counts across tokenizers are not directly comparable. Hardware/model metadata and fixture hash accompany measured output. Models run sequentially, so thermal state and caches can bias comparisons.
- Cloud results remain unmeasured without the required credential/model/pricing configuration. Never present an unmeasured baseline as a win for local inference.
