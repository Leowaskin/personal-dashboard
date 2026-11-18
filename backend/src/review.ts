import { createHash, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { sqlite } from './db/index.js';
import { googleIntegration } from './integrations/google.js';
import { taskInputSchema } from './contracts.js';
import { taskRepository, settingsRepository, planRepository } from './repository.js';
import { buildPlan } from './planner.js';
import { understand } from './understanding.js';
import { permissions } from './privacy.js';

sqlite.exec(`CREATE TABLE IF NOT EXISTS triage_results (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_previews (id TEXT PRIMARY KEY, payload TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS accepted_proposals (source_id TEXT PRIMARY KEY, task_id TEXT NOT NULL);`);
const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export class ReviewError extends Error {}
export function purgeReviews() {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  sqlite.prepare('DELETE FROM triage_results WHERE created_at < ?').run(cutoff);
  sqlite.prepare('DELETE FROM review_previews WHERE created_at < ?').run(new Date(Date.now() - 86400_000).toISOString());
}
export function listTriage() {
  purgeReviews();
  return (sqlite.prepare('SELECT * FROM triage_results ORDER BY created_at DESC LIMIT 100').all() as Array<{ id: string; message_id: string; result: string; created_at: string }>).map(row => ({ id: row.id, messageId: row.message_id, createdAt: row.created_at, ...JSON.parse(row.result) }));
}
let triaging = false;
export async function triageInbox() {
  if (triaging) throw new ReviewError('A triage run is already in progress');
  triaging = true;
  try {
    purgeReviews();
    const emails = await googleIntegration.triageEmails();
    for (const email of emails) {
      const text = `From: ${email.from}\nSubject: ${email.subject}\n${email.body}`;
      let result: object;
      try { result = { ...await understand(text, new Date().toISOString(), settingsRepository.get().timezone), subject: email.subject }; }
      catch { result = { subject: email.subject, error: 'Local model unavailable or invalid output; retry after checking Ollama', actions: [] }; }
      sqlite.prepare('INSERT OR REPLACE INTO triage_results VALUES (?,?,?,?)').run(digest(email.id), email.id, JSON.stringify(result), new Date().toISOString());
    }
    return listTriage();
  } finally { triaging = false; }
}
export const proposalSchema = z.object({ sourceId: z.string().min(1).max(500), task: taskInputSchema });
export const previewSchema = z.object({ proposals: z.array(proposalSchema).max(25), sync: z.boolean().default(false), date: z.iso.date().optional() });
type ReviewInput = z.infer<typeof previewSchema>;
async function context(date?: string) {
  const prefs = settingsRepository.get();
  const now = DateTime.now().setZone(prefs.timezone);
  const day = date ? DateTime.fromISO(date, { zone: prefs.timezone }) : now.startOf('day');
  if (!day.isValid || day < now.startOf('day') || day > now.plus({ days: 30 }).endOf('day')) throw new ReviewError('Choose a planning date between today and 30 days from now');
  const events = await googleIntegration.fixedEvents(day.startOf('day').toISO()!, day.endOf('day').toISO()!);
  const storedBlocks = planRepository.blocksForDay(day.startOf('day').toISO()!, day.endOf('day').toISO()!);
  const upcoming = planRepository.blocksForDay(now.toISO()!, now.plus({ days: 31 }).toISO()!);
  const frozen = storedBlocks.filter(block => Date.parse(block.start) < now.plus({ minutes: 30 }).toMillis() && Date.parse(block.end) > now.toMillis());
  const busy = [...events, ...frozen.map(block => ({ start: block.start, end: block.end }))];
  const candidates = taskRepository.activeForDate(day.toISODate()!).flatMap(task => {
    const committed = upcoming.filter(block => block.taskId === task.id && (frozen.some(b => b.id === block.id) || (task.type === 'ONE_TIME' && !storedBlocks.some(b => b.id === block.id))));
    const remaining = task.estimatedMinutes - committed.reduce((sum, b) => sum + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0);
    return remaining >= 5 ? [{ ...task, estimatedMinutes: remaining }] : [];
  });
  return { prefs, candidates, date: day.toISODate()!, busy, fingerprint: digest({ prefs, events, upcoming, tasks: taskRepository.list(), permissions: permissions(), date: day.toISODate() }) };
}
export async function previewReview(input: ReviewInput) {
  if (new Set(input.proposals.map(p => p.sourceId)).size !== input.proposals.length) throw new ReviewError('Duplicate proposals');
  if (input.sync && !googleIntegration.authenticated()) throw new ReviewError('Enable and connect Google to sync');
  const ctx = await context(input.date);
  const createdAt = new Date().toISOString();
  const candidates = input.proposals.map(p => ({ ...p.task, id: randomUUID(), status: 'PENDING' as const, createdAt, updatedAt: createdAt, completedAt: null }));
  for (const p of input.proposals) if (sqlite.prepare('SELECT 1 FROM accepted_proposals WHERE source_id=?').get(p.sourceId)) throw new ReviewError('Proposal already accepted');
  const plan = buildPlan(ctx.date, ctx.busy, createdAt, [...ctx.candidates, ...candidates]);
  const preview = { ...input, candidates, plan };
  const id = randomUUID();
  sqlite.prepare('INSERT INTO review_previews(id,payload,fingerprint,created_at) VALUES (?,?,?,?)').run(id, JSON.stringify(preview), ctx.fingerprint, createdAt);
  return { id, ...preview, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
}
export async function applyReview(id: string) {
  const row = sqlite.prepare('SELECT * FROM review_previews WHERE id=?').get(id) as { payload: string; fingerprint: string; created_at: string; applied: number } | undefined;
  if (!row || row.applied || Date.now() - Date.parse(row.created_at) > 5 * 60_000) throw new ReviewError('Preview expired or already applied; create a new preview');
  const preview = JSON.parse(row.payload) as Awaited<ReturnType<typeof previewReview>>;
  const ctx = await context(preview.plan.date);
  if (ctx.fingerprint !== row.fingerprint) throw new ReviewError('Tasks, permissions, preferences, or calendar changed; preview again');
  // Time itself can invalidate slots even if external state is unchanged.
  if (preview.plan.blocks.some(b => Date.parse(b.start) < Date.now() + 29 * 60_000)) throw new ReviewError('Preview slots are too close; preview again');
  sqlite.transaction(() => {
    const current = sqlite.prepare('SELECT applied FROM review_previews WHERE id=?').get(id) as { applied: number };
    if (current.applied) throw new ReviewError('Preview already applied');
    preview.proposals.forEach((p, index) => {
      const task = taskRepository.create(p.task);
      const candidateId = preview.candidates[index]!.id;
      preview.plan.blocks.forEach(b => { if (b.taskId === candidateId) b.taskId = task.id; });
      sqlite.prepare('INSERT INTO accepted_proposals VALUES (?,?)').run(p.sourceId, task.id);
    });
    const run = planRepository.record('confirmed-preview', 'APPLIED', { count: preview.plan.blocks.length });
    const day = DateTime.fromISO(preview.plan.date, { zone: ctx.prefs.timezone });
    planRepository.replaceFuture(preview.plan.blocks, run.id, preview.plan.freezeBefore, { start: day.startOf('day').toISO()!, end: day.plus({ days: 1 }).startOf('day').toISO()! });
    sqlite.prepare('UPDATE review_previews SET applied=1 WHERE id=?').run(id);
  })();
  // Google writes cannot join a SQLite transaction. Never recreate tasks on retry.
  if (preview.sync) {
    try { await googleIntegration.syncBlocks(preview.plan.blocks, preview.plan.date, preview.plan.freezeBefore); }
    catch { return { applied: true, calendarSync: 'failed', message: 'Tasks saved locally. Preview the existing plan again to retry calendar sync.' }; }
  }
  return { applied: true, calendarSync: preview.sync ? 'synced' : 'disabled' };
}
