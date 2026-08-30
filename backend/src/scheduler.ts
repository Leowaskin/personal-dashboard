import { DateTime } from 'luxon';
import { generateBriefing } from './briefing.js';
import { replanToday } from './orchestrator.js';
import { briefingRepository, settingsRepository } from './repository.js';
import { sendWhatsApp } from './whatsapp.js';

let lastCalendarCheck = 0;

export async function schedulerTick() {
  const prefs = settingsRepository.get();
  if (!prefs.onboardingComplete) return;
  const now = DateTime.now().setZone(prefs.timezone);
  const date = now.toISODate()!;
  const briefingDue = now.toFormat('HH:mm') >= prefs.briefingTime;
  if (briefingDue) {
    let briefing = briefingRepository.get(date);
    if (!briefing) {
      await replanToday('morning-briefing').catch(() => undefined);
      briefing = await generateBriefing(date);
    }
    if (briefing.deliveryStatus !== 'SENT' && await sendWhatsApp(briefing.content)) briefingRepository.markSent(briefing.id);
  }
  if (prefs.autoPlanEnabled && Date.now() - lastCalendarCheck >= 10 * 60_000) {
    lastCalendarCheck = Date.now();
    await replanToday('calendar-sync').catch(() => undefined);
  }
}

export function startScheduler() {
  schedulerTick().catch(() => undefined);
  return setInterval(() => schedulerTick().catch(() => undefined), 60_000);
}
