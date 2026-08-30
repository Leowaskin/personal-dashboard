import { DateTime, Interval } from 'luxon';
import { createHash } from 'node:crypto';
import type { BusyInterval, PlannedBlock } from './contracts.js';
import { planRepository, settingsRepository, taskRepository } from './repository.js';

type Candidate = ReturnType<typeof taskRepository.active>[number];

function rank(a: Candidate, b: Candidate) {
  const recurringA = a.type === 'ONE_TIME' ? 1 : 0;
  const recurringB = b.type === 'ONE_TIME' ? 1 : 0;
  if (recurringA !== recurringB) return recurringA - recurringB;
  if (a.deadline !== b.deadline) return (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999');
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.createdAt.localeCompare(b.createdAt);
}

export function buildPlan(date: string, busy: BusyInterval[], nowIso = new Date().toISOString()) {
  const prefs = settingsRepository.get();
  const zone = prefs.timezone;
  const dayStart = DateTime.fromISO(`${date}T${prefs.dayStart}`, { zone });
  const dayEnd = DateTime.fromISO(`${date}T${prefs.dayEnd}`, { zone });
  const weekday = dayStart.weekday;
  const freezeBefore = DateTime.fromISO(nowIso).setZone(zone).plus({ minutes: 30 });
  const effectiveStart = DateTime.max(dayStart, freezeBefore);
  const buffer = prefs.eventBufferMinutes;

  const occupied = busy.map((item) => Interval.fromDateTimes(
    DateTime.fromISO(item.start).setZone(zone).minus({ minutes: buffer }),
    DateTime.fromISO(item.end).setZone(zone).plus({ minutes: buffer }),
  )).filter((interval) => interval.isValid).sort((a, b) => a.start!.toMillis() - b.start!.toMillis());

  const free: Interval[] = [];
  let cursor = effectiveStart;
  for (const interval of occupied) {
    if (interval.end! <= cursor || interval.start! >= dayEnd) continue;
    if (interval.start! > cursor) free.push(Interval.fromDateTimes(cursor, DateTime.min(interval.start!, dayEnd)));
    cursor = DateTime.max(cursor, interval.end!);
  }
  if (cursor < dayEnd) free.push(Interval.fromDateTimes(cursor, dayEnd));

  const blocks: PlannedBlock[] = [];
  const unscheduled: Array<{ taskId: string; title: string; reason: string }> = [];
  let allocated = 0;
  const tasks = taskRepository.activeForDate(date).filter((task) => task.status === 'PENDING').sort(rank);

  if (!prefs.workingDays.includes(weekday)) {
    return { date, blocks, unscheduled: tasks.map((task) => ({ taskId: task.id, title: task.title, reason: 'Day is outside configured planning days' })), allocatedMinutes: 0, freezeBefore: freezeBefore.toISO()! };
  }

  for (const task of tasks) {
    let remaining = task.estimatedMinutes;
    let part = 0;
    for (let index = 0; index < free.length && remaining > 0; index++) {
      const slot = free[index]!;
      const constrainedStart = task.earliestStart ? DateTime.max(slot.start!, DateTime.fromISO(task.earliestStart).setZone(zone)) : slot.start!;
      const constrainedEnd = task.deadline ? DateTime.min(slot.end!, DateTime.fromISO(task.deadline).setZone(zone)) : slot.end!;
      if (constrainedEnd <= constrainedStart) continue;
      const hour = constrainedStart.hour;
      if (task.preferredTime === 'MORNING' && hour >= 12) continue;
      if (task.preferredTime === 'AFTERNOON' && (hour < 12 || hour >= 17)) continue;
      if (task.preferredTime === 'EVENING' && hour < 17) continue;
      const available = Math.floor(Interval.fromDateTimes(constrainedStart, constrainedEnd).length('minutes'));
      const chunk = task.splittable ? Math.min(available, remaining) : (available >= remaining ? remaining : 0);
      if (chunk < (task.splittable ? task.minimumChunkMinutes : remaining)) continue;
      if (allocated + chunk > prefs.maximumPlannedMinutes) break;
      const start = constrainedStart;
      const end = start.plus({ minutes: chunk });
      const id = createHash('sha256').update(`${task.id}:${date}:${part++}`).digest('hex').slice(0, 32);
      blocks.push({ id, taskId: task.id, title: task.title, start: start.toISO()!, end: end.toISO()! });
      const replacements: Interval[] = [];
      if (slot.start! < start) replacements.push(Interval.fromDateTimes(slot.start!, start));
      if (end < slot.end!) replacements.push(Interval.fromDateTimes(end, slot.end!));
      free.splice(index, 1, ...replacements);
      if (remaining > chunk && replacements.length === 1 && replacements[0]!.start! === end) index--;
      remaining -= chunk;
      allocated += chunk;
    }
    if (remaining > 0) unscheduled.push({ taskId: task.id, title: task.title, reason: 'Not enough eligible time remained' });
  }
  return { date, blocks, unscheduled, allocatedMinutes: allocated, freezeBefore: freezeBefore.toISO()! };
}

export function persistPlan(date: string, busy: BusyInterval[], reason: string) {
  const plan = buildPlan(date, busy);
  const run = planRepository.record(reason, 'APPLIED', { blocks: plan.blocks.length, unscheduled: plan.unscheduled });
  planRepository.replaceFuture(plan.blocks.map(({ title: _title, ...block }) => block), run.id, plan.freezeBefore);
  return { ...plan, runId: run.id };
}
