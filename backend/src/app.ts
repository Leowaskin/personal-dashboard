import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { config } from './config.js';
import { taskInputSchema, taskPatchSchema, settingsSchema } from './contracts.js';
import { briefingRepository, importLegacyTasks, planRepository, settingsRepository, taskRepository } from './repository.js';
import { googleIntegration } from './integrations/google.js';
import { replanAfterTaskChange, replanToday, requestReplan } from './orchestrator.js';
import { runAgent } from './agent.js';
import { generateBriefing } from './briefing.js';
import { whatsappState } from './whatsapp.js';
import { searchIntegrationStatus } from './web-search.js';

export const app = express();
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));
app.use(express.json());

app.get('/api/v1/health', (_req, res) => res.json({
  status: 'ok', database: 'connected', google: googleIntegration.authenticated() ? 'connected' : 'disconnected', whatsapp: whatsappState().status, search: searchIntegrationStatus(),
}));

app.get('/api/v1/tasks', (_req, res) => res.json({ tasks: taskRepository.list() }));
async function syncTaskChange(reason: string) {
  try {
    const plan = await replanAfterTaskChange(reason);
    return { status: plan ? 'synced' : 'not_configured' } as const;
  } catch (error) {
    // Do not lose a task just because a third-party Calendar request failed.
    console.error(`[Calendar] Could not sync task change (${reason})`, error);
    return { status: 'failed', message: error instanceof Error ? error.message : 'Calendar sync failed' } as const;
  }
}

app.post('/api/v1/tasks', async (req, res) => {
  const task = taskRepository.create(taskInputSchema.parse(req.body));
  const calendarSync = await syncTaskChange('task-created');
  res.status(201).json({ task, calendarSync });
});
app.patch('/api/v1/tasks/:id', async (req, res) => {
  const task = taskRepository.update(req.params.id, taskPatchSchema.parse(req.body));
  if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });
  const calendarSync = await syncTaskChange('task-updated');
  res.json({ task, calendarSync });
});
app.post('/api/v1/tasks/:id/complete', async (req, res) => {
  const task = taskRepository.complete(req.params.id);
  if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });
  const calendarSync = await syncTaskChange('task-completed');
  res.json({ task, calendarSync });
});
app.delete('/api/v1/tasks/:id', async (req, res) => {
  if (!taskRepository.remove(req.params.id)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });
  const calendarSync = await syncTaskChange('task-deleted');
  res.status(200).json({ calendarSync });
});

app.get('/api/v1/settings', (_req, res) => res.json({ settings: settingsRepository.get() }));
app.put('/api/v1/settings', (req, res) => {
  const input = settingsSchema.parse(req.body);
  if (input.onboardingComplete && taskRepository.active().some((task) => task.status === 'DRAFT')) {
    return res.status(409).json({ code: 'DRAFT_TASKS_REMAIN', message: 'Review and classify every imported draft task before completing onboarding.' });
  }
  const settings = settingsRepository.update(input);
  if (settings.autoPlanEnabled) requestReplan('settings-updated');
  res.json({ settings });
});
app.post('/api/v1/import/legacy-tasks', (_req, res) => res.json(importLegacyTasks()));

app.get('/api/v1/plans/today', (_req, res) => {
  const now = new Date();
  res.json({ blocks: planRepository.blocksForDay(new Date(now.setHours(0, 0, 0, 0)).toISOString(), new Date(now.setHours(23, 59, 59, 999)).toISOString()), runs: planRepository.recentRuns() });
});
app.post('/api/v1/plans/recompute', async (req, res) => res.json({ plan: await replanToday(req.body?.reason ?? 'manual') }));

app.get('/api/v1/briefings', (_req, res) => res.json({ briefings: briefingRepository.list() }));
app.post('/api/v1/briefings/generate', async (_req, res) => res.json({ briefing: await generateBriefing() }));
app.post('/api/v1/chat', async (req, res) => {
  const result = await runAgent(String(req.body?.prompt ?? ''), 'dashboard');
  const calendarSync = result.action === 'ADD_TASK' || result.action === 'COMPLETE_TASK'
    ? await syncTaskChange(`dashboard-${result.action.toLowerCase()}`)
    : undefined;
  res.json({ ...result, calendarSync });
});

app.get('/api/v1/integrations/status', (_req, res) => res.json({ google: googleIntegration.authenticated(), whatsapp: whatsappState(), search: searchIntegrationStatus() }));
const oauthReturnTargets = new Map<string, { url: string; expiresAt: number }>();

function safeLocalReturnTarget(value: unknown) {
  if (typeof value !== 'string') return config.FRONTEND_URL;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.origin;
  } catch {
    // Fall through to the configured frontend URL.
  }
  return config.FRONTEND_URL;
}

app.get('/auth/google', (req, res) => {
  const state = randomUUID();
  oauthReturnTargets.set(state, { url: safeLocalReturnTarget(req.query.returnTo), expiresAt: Date.now() + 10 * 60_000 });
  res.redirect(googleIntegration.authUrl(state));
});
app.get('/auth/google/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const target = oauthReturnTargets.get(state);
  oauthReturnTargets.delete(state);
  const returnTo = target && target.expiresAt > Date.now() ? target.url : config.FRONTEND_URL;
  if (req.query.error || !req.query.code) return res.redirect(`${returnTo}?auth=error`);
  try {
    await googleIntegration.exchange(String(req.query.code));
    res.redirect(`${returnTo}?auth=success`);
  } catch {
    res.redirect(`${returnTo}?auth=error`);
  }
});
app.post('/api/v1/auth/logout', (_req, res) => { googleIntegration.logout(); res.json({ success: true }); });
const calendarRangeSchema = z.object({
  start: z.iso.datetime({ offset: true }).optional(),
  end: z.iso.datetime({ offset: true }).optional(),
});

app.get('/api/v1/calendar/events', async (req, res) => {
  const range = calendarRangeSchema.parse(req.query);
  const now = new Date();
  const start = range.start ?? new Date(now.setHours(0, 0, 0, 0)).toISOString();
  const end = range.end ?? new Date(now.setHours(23, 59, 59, 999)).toISOString();
  const blocks = planRepository.blocksForDay(start, end).map((block) => ({
    ...block,
    title: taskRepository.get(block.taskId)?.title ?? 'Task',
  }));
  res.json({ events: await googleIntegration.fixedEvents(start, end), agentBlocks: blocks });
});
app.get('/api/v1/gmail/important', async (_req, res) => res.json({ emails: await googleIntegration.importantEmails() }));

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/auth/')) return res.sendFile(path.join(frontendDist, 'index.html'));
    next();
  });
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues });
  console.error(error);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unexpected error' });
};
app.use(errorHandler);
