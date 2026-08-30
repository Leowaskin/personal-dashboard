import fs from 'node:fs';
import { google } from 'googleapis';
import { config, paths } from '../config.js';
import type { BusyInterval, PlannedBlock } from '../contracts.js';
import { settingsRepository } from '../repository.js';
import { DateTime } from 'luxon';

const oauth = new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI);

function loadToken() {
  if (!fs.existsSync(paths.token)) return false;
  oauth.setCredentials(JSON.parse(fs.readFileSync(paths.token, 'utf8')));
  return true;
}
loadToken();

oauth.on('tokens', (tokens) => {
  const previous = fs.existsSync(paths.token) ? JSON.parse(fs.readFileSync(paths.token, 'utf8')) : {};
  fs.writeFileSync(paths.token, JSON.stringify({ ...previous, ...tokens }), { mode: 0o600 });
});

export const googleIntegration = {
  configured: () => Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  authenticated: () => fs.existsSync(paths.token),
  authUrl(state?: string) {
    return oauth.generateAuthUrl({
      access_type: 'offline', prompt: 'consent', state,
      // A single Calendar scope covers reading fixed events and managing the dedicated agent calendar.
      // Existing tokens need one reconnect to gain this scope.
      scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/gmail.readonly'],
    });
  },
  async exchange(code: string) {
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);
    fs.writeFileSync(paths.token, JSON.stringify(tokens), { mode: 0o600 });
  },
  logout() {
    if (fs.existsSync(paths.token)) fs.unlinkSync(paths.token);
    oauth.setCredentials({});
  },
  async fixedEvents(start: string, end: string): Promise<BusyInterval[]> {
    if (!this.authenticated()) return [];
    const calendar = google.calendar({ version: 'v3', auth: oauth });
    const response = await calendar.events.list({ calendarId: 'primary', timeMin: start, timeMax: end, singleEvents: true, orderBy: 'startTime', maxResults: 100 });
    return (response.data.items ?? []).flatMap((event) => {
      const eventStart = event.start?.dateTime ?? event.start?.date;
      const eventEnd = event.end?.dateTime ?? event.end?.date;
      return eventStart && eventEnd ? [{ start: eventStart, end: eventEnd, title: event.summary ?? undefined }] : [];
    });
  },
  async importantEmails() {
    if (!this.authenticated()) return [];
    const gmail = google.gmail({ version: 'v1', auth: oauth });
    const response = await gmail.users.messages.list({ userId: 'me', q: 'is:important is:unread', maxResults: 5 });
    return Promise.all((response.data.messages ?? []).map(async ({ id }) => {
      const message = await gmail.users.messages.get({ userId: 'me', id: id!, format: 'metadata', metadataHeaders: ['Subject', 'From'] });
      const headers = message.data.payload?.headers ?? [];
      return {
        id: id!, subject: headers.find((h) => h.name === 'Subject')?.value ?? 'No subject',
        from: (headers.find((h) => h.name === 'From')?.value ?? 'Unknown').split('<')[0]!.trim(),
      };
    }));
  },
  async ensureAgentCalendar() {
    const prefs = settingsRepository.get();
    if (prefs.agentCalendarId) return prefs.agentCalendarId;
    if (!this.authenticated()) return null;
    const calendar = google.calendar({ version: 'v3', auth: oauth });
    const created = await calendar.calendars.insert({ requestBody: { summary: 'Personal Agent Plan', timeZone: prefs.timezone } });
    const id = created.data.id!;
    settingsRepository.setCalendarId(id);
    return id;
  },
  async syncBlocks(blocks: PlannedBlock[], date: string) {
    const calendarId = await this.ensureAgentCalendar();
    if (!calendarId) return { synced: 0 };
    const calendar = google.calendar({ version: 'v3', auth: oauth });
    const prefs = settingsRepository.get();
    const day = DateTime.fromISO(date, { zone: prefs.timezone });
    const existing = await calendar.events.list({ calendarId, timeMin: day.startOf('day').toISO()!, timeMax: day.endOf('day').toISO()!, singleEvents: true, maxResults: 250 });
    const owned = new Map((existing.data.items ?? []).map((event) => [event.extendedProperties?.private?.personalAgentBlockId, event]));
    const desiredIds = new Set(blocks.map((block) => block.id));
    for (const event of existing.data.items ?? []) {
      const blockId = event.extendedProperties?.private?.personalAgentBlockId;
      if (blockId && !desiredIds.has(blockId) && event.id) await calendar.events.delete({ calendarId, eventId: event.id });
    }
    for (const block of blocks) {
      const requestBody = {
        summary: block.title,
        start: { dateTime: block.start, timeZone: prefs.timezone },
        end: { dateTime: block.end, timeZone: prefs.timezone },
        extendedProperties: { private: { personalAgentBlockId: block.id, source: 'personal-dashboard' } },
      };
      const current = owned.get(block.id);
      if (current?.id) await calendar.events.update({ calendarId, eventId: current.id, requestBody });
      else await calendar.events.insert({ calendarId, requestBody });
    }
    return { synced: blocks.length };
  },
};
