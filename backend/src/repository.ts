import fs from 'node:fs';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from './db/index.js';
import { agentActions, briefings, planRuns, scheduleBlocks, settings, taskOccurrences, tasks, webSearchRuns } from './db/schema.js';
import { paths } from './config.js';
import type { SettingsInput, TaskInput, TaskPatch } from './contracts.js';

export const taskRepository = {
  list: () => db.select().from(tasks).orderBy(asc(tasks.createdAt)).all(),
  active: () => db.select().from(tasks).where(inArray(tasks.status, ['DRAFT', 'PENDING'])).all(),
  activeForDate(date: string) {
    const completed = new Set(db.select({ taskId: taskOccurrences.taskId }).from(taskOccurrences)
      .where(and(eq(taskOccurrences.occurrenceDate, date), eq(taskOccurrences.status, 'COMPLETED'))).all().map((row) => row.taskId));
    return this.active().filter((task) => {
      if (completed.has(task.id)) return false;
      if (task.type !== 'RECURRING' || !task.recurrenceRule?.includes('BYDAY=')) return true;
      const dayCodes = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
      const day = dayCodes[new Date(`${date}T12:00:00`).getDay() === 0 ? 6 : new Date(`${date}T12:00:00`).getDay() - 1];
      return task.recurrenceRule.split('BYDAY=')[1]?.split(';')[0]?.split(',').includes(day!) ?? true;
    });
  },
  get: (id: string) => db.select().from(tasks).where(eq(tasks.id, id)).get(),
  create(input: TaskInput, status: 'DRAFT' | 'PENDING' = 'PENDING') {
    const now = new Date().toISOString();
    const row = { id: randomUUID(), ...input, status, createdAt: now, updatedAt: now } as const;
    db.insert(tasks).values(row).run();
    return this.get(row.id)!;
  },
  update(id: string, patch: TaskPatch) {
    db.update(tasks).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(tasks.id, id)).run();
    return this.get(id);
  },
  complete(id: string) {
    const now = new Date().toISOString();
    const current = this.get(id);
    if (!current) return undefined;
    if (current.type === 'HABIT' || current.type === 'RECURRING') {
      const date = now.slice(0, 10);
      db.insert(taskOccurrences).values({ id: randomUUID(), taskId: id, occurrenceDate: date, status: 'COMPLETED', completedAt: now }).onConflictDoUpdate({
        target: [taskOccurrences.taskId, taskOccurrences.occurrenceDate], set: { status: 'COMPLETED', completedAt: now },
      }).run();
      return current;
    }
    db.update(tasks).set({ status: 'COMPLETED', completedAt: now, updatedAt: now }).where(eq(tasks.id, id)).run();
    return this.get(id);
  },
  remove(id: string) {
    return db.delete(tasks).where(eq(tasks.id, id)).run().changes > 0;
  },
};

export const settingsRepository = {
  get() {
    const row = db.select().from(settings).where(eq(settings.id, 1)).get()!;
    return { ...row, workingDays: JSON.parse(row.workingDays) as number[], newsTopics: JSON.parse(row.newsTopics) as string[] };
  },
  update(input: SettingsInput) {
    db.update(settings).set({ ...input, workingDays: JSON.stringify(input.workingDays), newsTopics: JSON.stringify(input.newsTopics), updatedAt: new Date().toISOString() })
      .where(eq(settings.id, 1)).run();
    return this.get();
  },
  setCalendarId(agentCalendarId: string) {
    db.update(settings).set({ agentCalendarId, updatedAt: new Date().toISOString() }).where(eq(settings.id, 1)).run();
  },
};

export const planRepository = {
  blocksForDay(start: string, end: string) {
    return db.select().from(scheduleBlocks)
      .where(and(sql`${scheduleBlocks.start} < ${end}`, sql`${scheduleBlocks.end} > ${start}`))
      .orderBy(asc(scheduleBlocks.start)).all();
  },
  replaceFuture(blocks: Array<{ id: string; taskId: string; start: string; end: string }>, runId: string, freezeBefore: string) {
    db.transaction((tx) => {
      tx.delete(scheduleBlocks).where(and(sql`${scheduleBlocks.start} >= ${freezeBefore}`, eq(scheduleBlocks.state, 'PLANNED'))).run();
      const now = new Date().toISOString();
      if (blocks.length) tx.insert(scheduleBlocks).values(blocks.map((b) => ({ ...b, planRunId: runId, createdAt: now, updatedAt: now }))).run();
    });
  },
  record(reason: string, status: string, summary: unknown) {
    const row = { id: randomUUID(), reason, status, summary: JSON.stringify(summary), createdAt: new Date().toISOString() };
    db.insert(planRuns).values(row).run();
    return row;
  },
  recentRuns() { return db.select().from(planRuns).orderBy(sql`${planRuns.createdAt} DESC`).limit(20).all(); },
};

export function recordAction(source: string, action: string, input: unknown, result: unknown, status = 'SUCCEEDED') {
  db.insert(agentActions).values({
    id: randomUUID(), source, action, input: JSON.stringify(input), result: JSON.stringify(result), status, createdAt: new Date().toISOString(),
  }).run();
}

export function recordSearch(input: { query: string; provider: string; urls: string[]; status: string; latencyMs: number; source: string }) {
  db.insert(webSearchRuns).values({
    id: randomUUID(), query: input.query, provider: input.provider, resultUrls: JSON.stringify(input.urls),
    status: input.status, latencyMs: input.latencyMs, source: input.source, createdAt: new Date().toISOString(),
  }).run();
}

export const briefingRepository = {
  get(date: string) { return db.select().from(briefings).where(eq(briefings.briefingDate, date)).get(); },
  list() { return db.select().from(briefings).orderBy(sql`${briefings.briefingDate} DESC`).limit(30).all(); },
  create(date: string, content: string) {
    const existing = this.get(date);
    if (existing) return existing;
    const row = { id: randomUUID(), briefingDate: date, content, deliveryStatus: 'PENDING', sentAt: null, createdAt: new Date().toISOString() };
    db.insert(briefings).values(row).run();
    return row;
  },
  markSent(id: string) { db.update(briefings).set({ deliveryStatus: 'SENT', sentAt: new Date().toISOString() }).where(eq(briefings.id, id)).run(); },
};

export function importLegacyTasks() {
  const count = db.select({ count: sql<number>`count(*)` }).from(tasks).get()?.count ?? 0;
  if (count || !fs.existsSync(paths.legacyTasks)) return { imported: 0 };
  const legacy = JSON.parse(fs.readFileSync(paths.legacyTasks, 'utf8')) as Array<{ title: string; completed?: boolean }>;
  for (const item of legacy) {
    taskRepository.create({
      title: item.title.trim(), notes: '', type: 'ONE_TIME', priority: 3, estimatedMinutes: 30,
      deadline: null, earliestStart: null, preferredTime: 'ANY', energy: 'MEDIUM', splittable: false,
      minimumChunkMinutes: 30, recurrenceRule: null,
    }, 'DRAFT');
  }
  return { imported: legacy.length };
}
