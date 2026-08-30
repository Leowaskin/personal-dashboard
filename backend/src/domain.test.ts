import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from './db/index.js';
import { taskInputSchema } from './contracts.js';
import { buildPlan } from './planner.js';
import { settingsRepository, taskRepository } from './repository.js';
import { runAgent } from './agent.js';

beforeEach(() => {
  sqlite.exec('DELETE FROM schedule_blocks; DELETE FROM plan_runs; DELETE FROM agent_actions; DELETE FROM tasks;');
  const current = settingsRepository.get();
  settingsRepository.update({
    ...current,
    dayStart: '08:00',
    dayEnd: '22:00',
    maximumPlannedMinutes: 480,
    onboardingComplete: true,
    autoPlanEnabled: false,
  });
});

describe('task domain', () => {
  it('creates, lists, and completes a validated task', () => {
    const input = taskInputSchema.parse({ title: 'Work on startup', estimatedMinutes: 60 });
    const created = taskRepository.create(input);
    expect(created.status).toBe('PENDING');
    expect(taskRepository.list()).toHaveLength(1);
    expect(taskRepository.complete(created.id)?.status).toBe('COMPLETED');
  });

  it('rejects invalid durations', () => {
    expect(() => taskInputSchema.parse({ title: 'Impossible', estimatedMinutes: 0 })).toThrow();
  });
});

describe('deterministic planner', () => {
  it('places tasks without overlaps', () => {
    taskRepository.create(taskInputSchema.parse({ title: 'First', estimatedMinutes: 30 }));
    taskRepository.create(taskInputSchema.parse({ title: 'Second', estimatedMinutes: 45 }));
    const date = new Date().toISOString().slice(0, 10);
    const plan = buildPlan(date, [], `${date}T07:00:00-07:00`);
    expect(plan.blocks).toHaveLength(2);
    expect(new Date(plan.blocks[0]!.end).getTime()).toBeLessThanOrEqual(new Date(plan.blocks[1]!.start).getTime());
  });

  it('respects fixed-event buffers', () => {
    taskRepository.create(taskInputSchema.parse({ title: 'Focused work', estimatedMinutes: 60 }));
    const date = new Date().toISOString().slice(0, 10);
    const zone = settingsRepository.get().timezone;
    const busy = [{ start: `${date}T08:30:00-07:00`, end: `${date}T09:30:00-07:00` }];
    const plan = buildPlan(date, busy, `${date}T07:00:00-07:00`);
    expect(plan.blocks).toHaveLength(1);
    expect(new Date(plan.blocks[0]!.start).getTime()).toBeGreaterThanOrEqual(new Date(`${date}T09:40:00-07:00`).getTime());
    expect(zone).toBeTruthy();
  });
});

describe('WhatsApp task language', () => {
  it('understands a natural language task with a time window', async () => {
    const result = await runAgent('Could you add a task, name it Grocery shopping, for today between 1 to 2 pm it is a one time event', 'whatsapp');
    expect(result.action).toBe('ADD_TASK');
    const task = taskRepository.list()[0]!;
    expect(task.title).toBe('Grocery shopping');
    expect(task.estimatedMinutes).toBe(60);
    expect(task.type).toBe('ONE_TIME');
    expect(task.earliestStart).toBeTruthy();
    expect(task.deadline).toBeTruthy();
  });

  it('answers a greeting without requiring Ollama', async () => {
    const result = await runAgent('Hello there', 'whatsapp');
    expect(result.action).toBe('CHAT');
    expect(result.reply).toMatch(/Hey Leo/);
  });
});
