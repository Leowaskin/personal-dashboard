import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import axios from 'axios';
import { fixtures, fixtureVersion, referenceNow } from './fixtures.js';
import { maximumOutputTokens, reserveCost, withinBudget } from './budget.js';

// No dotenv import. No user database, inbox, credentials file, or arbitrary input path.
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dayflow-benchmark-')), 'benchmark.sqlite');
const { understandingMessages, understandingFormat, validateUnderstanding } = await import('../src/understanding.js');
const { localCompletion, loopbackUrl, localTransport } = await import('../src/local-model.js');
const { taskInputSchema } = await import('../src/contracts.js');
const { buildPlan } = await import('../src/planner.js');
const { settingsRepository } = await import('../src/repository.js');
const { sqlite } = await import('../src/db/index.js');
settingsRepository.update({ ...settingsRepository.get(), timezone: 'America/Los_Angeles', dayStart: '08:00', dayEnd: '18:00', maximumPlannedMinutes: 480 });
const cloud = process.argv.includes('--cloud');
const outputDir = path.resolve('benchmarks/results');
fs.mkdirSync(outputDir, { recursive: true });
const modelNames = (process.env.BENCH_LOCAL_MODELS || process.env.OLLAMA_MODEL || 'llama3').split(',').map(s => s.trim()).filter(Boolean);
const rateIn = Number(process.env.BENCH_INPUT_USD_PER_MILLION);
const rateOut = Number(process.env.BENCH_OUTPUT_USD_PER_MILLION);
if (cloud && (!process.env.OPENAI_API_KEY || !process.env.BENCH_CLOUD_MODEL || !process.env.BENCH_PRICING_SOURCE || !(rateIn > 0) || !(rateOut > 0))) throw new Error('Cloud requires OPENAI_API_KEY, BENCH_CLOUD_MODEL, BENCH_PRICING_SOURCE and positive input/output prices per million tokens');
let reservedUsd = 0;
const rows: Array<Record<string, unknown>> = [];
const availability: Array<Record<string, unknown>> = [];
const maxOutputTokens = maximumOutputTokens;
const providers = [...modelNames.map(model => ({ model, cloud: false })), ...(cloud ? [{ model: process.env.BENCH_CLOUD_MODEL!, cloud: true }] : [])];
for (const provider of providers) {
  let metadata: unknown;
  if (!provider.cloud) {
    try { const shown = (await axios.post(`${loopbackUrl(process.env.OLLAMA_URL || 'http://127.0.0.1:11434')}/api/show`, { model: provider.model }, { ...localTransport, timeout: 3000 })).data; metadata = { details: shown.details, modelInfo: shown.model_info, capabilities: shown.capabilities }; }
    catch { availability.push({ ...provider, status: 'unmeasured', reason: 'Local model service or model unavailable' }); continue; }
  }
  availability.push({ ...provider, status: 'running', metadata });
  let exhausted = false;
  for (let repetition = -1; repetition < 3 && !exhausted; repetition++) {
    // One separate warm-up per provider; repeated fixture trials follow.
    for (const fixture of repetition === -1 ? fixtures.slice(0, 1) : fixtures) {
      const messages = understandingMessages(fixture.text, referenceNow, 'America/Los_Angeles');
      const requestBody = { model: provider.model, messages, max_completion_tokens: maxOutputTokens, store: false, response_format: { type: 'json_schema', json_schema: { name: 'understanding', schema: understandingFormat, strict: false } } };
      const reserved = provider.cloud ? reserveCost(requestBody, rateIn, rateOut) : 0;
      if (provider.cloud && !withinBudget(reservedUsd, reserved)) { exhausted = true; break; }
      reservedUsd += reserved; // No refunds on failure: conservative upper-bound accounting.
      const start = performance.now();
      let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
      let raw = '';
      try {
        if (provider.cloud) {
          const response = await axios.post('https://api.openai.com/v1/chat/completions', requestBody, { timeout: 90_000, proxy: false, maxRedirects: 0, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
          raw = response.data.choices?.[0]?.message?.content || '';
          usage = response.data.usage || {};
        } else { const completion = await localCompletion(messages, understandingFormat, provider.model); raw = completion.text; usage = { prompt_tokens: completion.promptTokens, completion_tokens: completion.outputTokens }; }
        const result = validateUnderstanding(raw, fixture.text);
        const tasks = result.actions.map((a, index) => ({ ...taskInputSchema.parse(a.task), id: `benchmark-${index}`, status: 'PENDING' as const, createdAt: referenceNow, updatedAt: referenceNow, completedAt: null }));
        const busy = [{ start: '2026-11-19T10:00:00-08:00', end: '2026-11-19T11:00:00-08:00' }];
        const plan = buildPlan('2026-11-19', busy, referenceNow, tasks);
        const violations = plan.blocks.filter((block, index) => {
          const task = tasks.find(t => t.id === block.taskId)!;
          return (task.deadline && Date.parse(block.end) > Date.parse(task.deadline)) || (task.earliestStart && Date.parse(block.start) < Date.parse(task.earliestStart)) || plan.blocks.some((other, j) => index !== j && other.start < block.end && other.end > block.start) || busy.some(b => Date.parse(block.start) < Date.parse(b.end) + 600000 && Date.parse(block.end) > Date.parse(b.start) - 600000);
        }).length;
        rows.push({ ...provider, fixture: fixture.id, repetition, warmup: repetition === -1, latencyMs: performance.now() - start, schemaValid: true, categoryCorrect: result.category === fixture.expected.category, actionCountCorrect: result.actions.length === fixture.expected.actionCount, durationCorrect: fixture.expected.minutes === null ? result.actions.length === 0 : result.actions[0]?.task.estimatedMinutes === fixture.expected.minutes, deadlineCorrect: fixture.expected.deadline === null ? result.actions.every(a => a.task.deadline === null) : Date.parse(result.actions[0]?.task.deadline || '') === Date.parse(fixture.expected.deadline), uncertaintyCorrect: result.uncertain === fixture.expected.uncertain, constraintViolations: violations, unscheduled: plan.unscheduled.length, outputCharacters: raw.length, usage, actualCostUsd: provider.cloud ? ((usage.prompt_tokens || 0) * rateIn + (usage.completion_tokens || 0) * rateOut) / 1e6 : 0 });
      } catch {
        rows.push({ ...provider, fixture: fixture.id, repetition, warmup: repetition === -1, latencyMs: performance.now() - start, schemaValid: false, failure: 'Request failed or schema/evidence validation failed' });
      }
      // Checkpoint after every request; never print response errors or auth headers.
      fs.writeFileSync(path.join(outputDir, 'latest.json'), JSON.stringify({ fixtureVersion, fixtureHash: createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'), generatedAt: new Date().toISOString(), hardware: { platform: os.platform(), arch: os.arch(), memoryBytes: os.totalmem(), cpu: os.cpus()[0]?.model }, node: process.version, options: { temperature: 'local=0; cloud=provider default', repetitions: 3, maxOutputTokens }, pricing: cloud ? { input: rateIn, output: rateOut, source: process.env.BENCH_PRICING_SOURCE } : null, reservedUsd, availability, rows }, null, 2));
    }
  }
}
const lines = ['# Local vs cloud benchmark results', '', `Fixture version: ${fixtureVersion}. 60 synthetic cases; three measured repetitions and one separate warm-up.`, '', '| Model | Measured trials | Schema valid | Category accuracy | Action count | Deadline accuracy | Median / p95 ms |', '|---|---:|---:|---:|---:|---:|---|'];
for (const provider of providers) {
  const measured = rows.filter(r => r.model === provider.model && r.cloud === provider.cloud && !r.warmup);
  const latencies = measured.map(r => Number(r.latencyMs)).sort((a,b) => a-b);
  const score = (key: string) => measured.length ? `${(100 * measured.filter(r => r[key] === true).length / measured.length).toFixed(1)}%` : 'unmeasured';
  lines.push(`| ${provider.model} (${provider.cloud ? 'cloud' : 'local'}) | ${measured.length} | ${score('schemaValid')} | ${score('categoryCorrect')} | ${score('actionCountCorrect')} | ${score('deadlineCorrect')} | ${latencies.length ? `${latencies[Math.floor(latencies.length / 2)]!.toFixed(0)} / ${latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * .95))]!.toFixed(0)}` : 'unmeasured'} |`);
}
lines.push('', `Conservative cloud budget reserved: $${reservedUsd.toFixed(4)} of $5. See latest.json for per-trial timing, cost, extraction scores, failures and schedule constraint checks.`, '', '## Interpretation', 'Unmeasured models cannot support a quality or speed claim. Use schema validity and extraction accuracy together: safe scheduling does not imply correct intent extraction. The same deterministic planner enforces constraints for all models, so zero conflicts is an engineering property, not evidence of model superiority.', '', 'This small templated synthetic set is a regression baseline, not a representative inbox study. Warm-up is not a guaranteed cold-cache measurement. Latency includes transport, schema validation and planning; no streaming time-to-first-token is measured. Cloud traffic contains only the fixtures shipped with this runner. No real inbox or task data is loaded.');
if (!cloud) lines.push('', 'Cloud baseline: **unmeasured**. Configure the OpenAI credential, model and pricing variables documented in ../README.md, then run with --cloud. No local-vs-cloud performance conclusion is supported yet.');
fs.writeFileSync(path.join(outputDir, 'REPORT.md'), lines.join('\n'));
fs.writeFileSync(path.join(outputDir, 'availability.json'), JSON.stringify(availability, null, 2));
sqlite.close();
console.log(`Report written to ${outputDir}; ${rows.filter(r => !r.warmup).length} measured trials.`);
