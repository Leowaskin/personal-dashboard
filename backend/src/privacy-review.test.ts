import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { DateTime } from 'luxon';
import { sqlite } from './db/index.js';
import { loopbackUrl, localChat } from './local-model.js';
import { allowed, setPermission } from './privacy.js';
import { googleIntegration } from './integrations/google.js';
import { searchWeb } from './web-search.js';
import { validateUnderstanding } from './understanding.js';
import { applyReview, previewReview, previewSchema, listTriage, purgeReviews, triageInbox } from './review.js';
import { planRepository, settingsRepository, taskRepository } from './repository.js';
import { taskInputSchema } from './contracts.js';
import { buildPlan } from './planner.js';

beforeEach(() => {
  vi.restoreAllMocks();
  sqlite.exec('DELETE FROM schedule_blocks; DELETE FROM plan_runs; DELETE FROM triage_results; DELETE FROM review_previews; DELETE FROM accepted_proposals; DELETE FROM privacy_permissions; DELETE FROM tasks;');
  settingsRepository.update({ ...settingsRepository.get(), timezone: 'America/Los_Angeles', dayStart: '00:00', dayEnd: '23:59', workingDays: [1,2,3,4,5,6,7], maximumPlannedMinutes: 480 });
});
describe('privacy boundary', () => {
  it('rejects nonliteral hosts, credentials, paths and remote services', () => {
    for (const url of ['https://example.com', 'http://localhost:11434', 'http://127.0.0.1.evil.test', 'http://u:p@127.0.0.1', 'file:///tmp/a', 'http://127.0.0.1/proxy']) expect(() => loopbackUrl(url)).toThrow();
    expect(loopbackUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
  });
  it('defaults integrations off even with prior credentials and makes no external calls', async () => {
    const post = vi.spyOn(axios, 'post'); const get = vi.spyOn(axios, 'get');
    expect(allowed('google')).toBe(false);
    expect(googleIntegration.authenticated()).toBe(false);
    expect(await googleIntegration.fixedEvents('a', 'b')).toEqual([]);
    expect(await googleIntegration.importantEmails()).toEqual([]);
    await expect(googleIntegration.triageEmails()).rejects.toThrow();
    expect((await searchWeb('current news', 'dashboard')).status).toBe('unavailable');
    expect(post).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
  it('disables proxy and redirects on inference and never falls back', async () => {
    const post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('offline'));
    await expect(localChat([{ role: 'user', content: 'synthetic' }])).rejects.toThrow('offline');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[2]).toMatchObject({ proxy: false, maxRedirects: 0 });
  });
});
describe('review workflow', () => {
  it('rejects malformed output and fabricated evidence', () => {
    expect(() => validateUnderstanding('{}', 'source')).toThrow();
    expect(() => validateUnderstanding(JSON.stringify({ priority: 'normal', category: 'action', summary: 'test', uncertain: false, actions: [{ task: { title: 'test' }, evidence: 'invented' }] }), 'source')).toThrow();
  });
  it('records model failures without storing the raw email body', async () => {
    vi.spyOn(googleIntegration, 'triageEmails').mockResolvedValue([{ id: 'synthetic', subject: 'Test', from: 'test@example.invalid', body: 'PRIVATE_BODY' }]);
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('offline'));
    const rows = await triageInbox();
    expect(rows[0].error).toContain('Local model');
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_BODY');
  });
  it('previews without writing tasks, applies once, and deduplicates accepted sources', async () => {
    const input = previewSchema.parse({ proposals: [{ sourceId: 'email:0', task: { title: 'Test' } }] });
    const preview = await previewReview(input);
    expect(taskRepository.list()).toHaveLength(0);
    expect((await applyReview(preview.id)).applied).toBe(true);
    expect(taskRepository.list()).toHaveLength(1);
    await expect(applyReview(preview.id)).rejects.toThrow();
    await expect(previewReview(input)).rejects.toThrow('already accepted');
  });
  it('rejects stale state, expired previews and changed permissions', async () => {
    const input = previewSchema.parse({ proposals: [] });
    const first = await previewReview(input); setPermission('search', true);
    await expect(applyReview(first.id)).rejects.toThrow('changed');
    const second = await previewReview(input);
    sqlite.prepare('UPDATE review_previews SET created_at=? WHERE id=?').run('2020-01-01', second.id);
    await expect(applyReview(second.id)).rejects.toThrow('expired');
  });
  it('rechecks Google availability before confirmation', async () => {
    vi.spyOn(googleIntegration, 'authenticated').mockReturnValue(true);
    const events = vi.spyOn(googleIntegration, 'fixedEvents').mockResolvedValue([]);
    const preview = await previewReview(previewSchema.parse({ proposals: [], sync: true }));
    events.mockResolvedValue([{ start: '2026-11-18T10:00:00-08:00', end: '2026-11-18T11:00:00-08:00' }]);
    await expect(applyReview(preview.id)).rejects.toThrow('changed');
  });
  it('purges expired local triage records', () => {
    sqlite.prepare('INSERT INTO triage_results VALUES (?,?,?,?)').run('old', 'synthetic', '{}', '2020-01-01');
    purgeReviews(); expect(listTriage()).toEqual([]);
  });
  it('preserves other planning days and avoids scheduling the same one-time work twice', async () => {
    const tomorrow = DateTime.now().setZone('America/Los_Angeles').plus({ days: 1 }).startOf('day');
    const following = tomorrow.plus({ days: 1 });
    const task = taskRepository.create(taskInputSchema.parse({ title: 'Already committed', estimatedMinutes: 30 }));
    const run = planRepository.record('test', 'APPLIED', {});
    planRepository.replaceFuture([{ id: 'preserved', taskId: task.id, start: tomorrow.set({ hour: 10 }).toISO()!, end: tomorrow.set({ hour: 10, minute: 30 }).toISO()! }], run.id, new Date().toISOString());
    const preview = await previewReview(previewSchema.parse({ date: following.toISODate(), proposals: [] }));
    expect(preview.plan.blocks).toHaveLength(0);
    await applyReview(preview.id);
    expect(planRepository.blocksForDay(tomorrow.toISO()!, following.toISO()!)).toHaveLength(1);
  });
  it('retains local tasks after a calendar failure and prevents duplicate retries', async () => {
    vi.spyOn(googleIntegration, 'authenticated').mockReturnValue(true);
    vi.spyOn(googleIntegration, 'fixedEvents').mockResolvedValue([]);
    vi.spyOn(googleIntegration, 'syncBlocks').mockRejectedValue(new Error('Synthetic network failure'));
    const preview = await previewReview(previewSchema.parse({ proposals: [{ sourceId: 'retry-test', task: { title: 'Saved' } }], sync: true }));
    expect((await applyReview(preview.id)).calendarSync).toBe('failed');
    expect(taskRepository.list()).toHaveLength(1);
    await expect(applyReview(preview.id)).rejects.toThrow('already applied');
  });
  it('bounds preferred time windows across DST changes and preserves buffers', () => {
    const task = taskRepository.create(taskInputSchema.parse({ title: 'Afternoon', preferredTime: 'AFTERNOON', estimatedMinutes: 60 }));
    const plan = buildPlan('2026-11-01', [{ start: '2026-11-01T12:00:00-08:00', end: '2026-11-01T13:00:00-08:00' }], '2026-11-01T07:00:00-08:00', [task]);
    expect(plan.blocks[0]?.start).toBe('2026-11-01T13:10:00.000-08:00');
  });
});
