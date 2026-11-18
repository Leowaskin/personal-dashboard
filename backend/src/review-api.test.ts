import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import axios from 'axios';
vi.mock('./whatsapp.js', () => ({ whatsappState: () => ({ status: 'DISABLED' }), startWhatsApp: vi.fn(), stopWhatsApp: vi.fn() }));
import { app } from './app.js';
import { sqlite } from './db/index.js';

beforeEach(() => {
  vi.restoreAllMocks();
  sqlite.exec('DELETE FROM privacy_permissions; DELETE FROM triage_results; DELETE FROM review_previews;');
});
describe('review HTTP boundaries', () => {
  it('rejects cross-site mutations before changing permissions', async () => {
    await request(app).put('/api/v1/privacy').set('Origin', 'https://untrusted.example').send({ name: 'google', enabled: true }).expect(403);
    expect(sqlite.prepare('SELECT * FROM privacy_permissions').all()).toHaveLength(0);
  });
  it('validates the permission name and returns no credential values', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    await request(app).put('/api/v1/privacy').send({ name: 'arbitrary', enabled: true }).expect(400);
    const response = await request(app).get('/api/v1/privacy').expect(200);
    expect(response.body.permissions).toEqual({ google: false, whatsapp: false, search: false, news: false });
    expect(response.body).not.toHaveProperty('token');
  });
  it('rejects malformed model instructions at the API boundary', async () => {
    await request(app).post('/api/v1/reviews/interpret').send({ text: '' }).expect(400);
    await request(app).post('/api/v1/reviews/preview').send({ proposals: [{ sourceId: 'test', task: { title: 'Invalid', estimatedMinutes: -1 } }] }).expect(400);
  });
  it('handles absent preview IDs without applying work', async () => {
    await request(app).post('/api/v1/reviews/apply').send({ id: '00000000-0000-4000-8000-000000000000' }).expect(409);
  });
});
