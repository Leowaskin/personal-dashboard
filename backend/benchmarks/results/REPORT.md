# Local vs cloud benchmark results

Fixture version: 1. 60 synthetic cases; three measured repetitions and one separate warm-up.

| Model | Measured trials | Schema valid | Category accuracy | Action count | Deadline accuracy | Median / p95 ms |
|---|---:|---:|---:|---:|---:|---|
| llama3:latest (local) | 180 | 100.0% | 58.3% | 83.3% | 53.3% | 7673 / 9620 |
| qwen3:4b (local) | 180 | 100.0% | 83.3% | 66.7% | 66.7% | 7035 / 8809 |

Cloud baseline: **unmeasured**; no cloud credentials or model/pricing configuration were supplied. Conservative cloud budget reserved: $0.0000 of $5. See the local latest.json checkpoint for per-trial timing, extraction scores, failures and schedule constraint checks.

## Interpretation
Unmeasured models cannot support a quality or speed claim. Use schema validity and extraction accuracy together: safe scheduling does not imply correct intent extraction. The same deterministic planner enforces constraints for all models, so zero conflicts is an engineering property, not evidence of model superiority.

This small templated synthetic set is a regression baseline, not a representative inbox study. Warm-up is not a guaranteed cold-cache measurement. Latency includes transport, schema validation and planning; no streaming time-to-first-token is measured. Cloud traffic contains only the fixtures shipped with this runner. No real inbox or task data is loaded.
