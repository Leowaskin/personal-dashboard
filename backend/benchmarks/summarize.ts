import fs from 'node:fs';
import path from 'node:path';

const directory = path.resolve('benchmarks/results');
const snapshot = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8')) as { generatedAt: string; reservedUsd: number; rows: Array<Record<string, unknown>> };
const lines = ['# Benchmark progress snapshot', '', `Generated from checkpoint ${snapshot.generatedAt}. This is a partial run, not a completed comparison. Run npm run benchmark:summary --prefix backend to refresh.`, '', '| Model | Measured / planned | Valid schema + evidence | Category | Action count | Deadline | Median latency |', '|---|---:|---:|---:|---:|---:|---:|'];
for (const model of ['llama3:latest', 'qwen3:4b']) {
  const rows = snapshot.rows.filter(row => row.model === model && !row.warmup);
  const percent = (key: string) => rows.length ? `${(100 * rows.filter(r => r[key] === true).length / rows.length).toFixed(1)}%` : 'unmeasured';
  const times = rows.map(r => Number(r.latencyMs)).sort((a,b) => a-b);
  lines.push(`| ${model} | ${rows.length} / 180 | ${percent('schemaValid')} | ${percent('categoryCorrect')} | ${percent('actionCountCorrect')} | ${percent('deadlineCorrect')} | ${times.length ? `${times[Math.floor(times.length / 2)]!.toFixed(0)} ms` : 'unmeasured'} |`);
}
lines.push('', 'OpenAI cloud baseline: **unmeasured**. No API credential, exact model and pricing configuration were supplied. The runner will not guess a cloud baseline or send real data.', '', `Cloud budget reserved so far: $${snapshot.reservedUsd.toFixed(4)}.`, '', '## Engineering findings', '', '- The first harness attempt failed before inference because Ollama could not compile the full ISO-date regular expression emitted by Zod. The corrected model-facing grammar omits regex/format annotations while application-side Zod validation still checks dates and bounds. Initial rejected-schema timings are excluded from this checkpoint.', '- Valid JSON is not sufficient evidence of correct task extraction or deadline interpretation. Review remains necessary, particularly for ambiguous dates and hostile email instructions.', '- All models feed the same deterministic planner. Conflict prevention belongs to that engine; it is not evidence that one model understands scheduling better.', '- This templated synthetic corpus is deliberately narrow. A partial run cannot justify a local-vs-cloud quality, speed or cost claim. See README.md for the reproducibility method and limitations.', '', 'The full background run replaces REPORT.md after both local models finish. latest.json checkpoints every request. This snapshot will not update automatically.');
fs.writeFileSync(path.join(directory, 'PROGRESS.md'), lines.join('\n'));
console.log(lines.join('\n'));
