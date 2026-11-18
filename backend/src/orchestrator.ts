import { DateTime } from 'luxon';
import { googleIntegration } from './integrations/google.js';
import { persistPlan } from './planner.js';
import { settingsRepository } from './repository.js';

let pending: NodeJS.Timeout | null = null;

export async function replanToday(reason: string) {
  const prefs = settingsRepository.get();
  if (!prefs.onboardingComplete) throw new Error('Complete onboarding before planning');
  const now = DateTime.now().setZone(prefs.timezone);
  const start = now.startOf('day').toISO()!;
  const end = now.endOf('day').toISO()!;
  const busy = await googleIntegration.fixedEvents(start, end);
  const plan = persistPlan(now.toISODate()!, busy, reason);
  // Calendar writes are performed only by the confirmed preview workflow.
  return plan;
}

/**
 * Task edits are user-visible actions, so they should be reflected in Calendar
 * immediately instead of waiting for the background debounce.  Before setup is
 * complete there is intentionally nothing to plan or sync yet.
 */
export async function replanAfterTaskChange(reason: string) {
  if (!settingsRepository.get().onboardingComplete) return null;
  return replanToday(reason);
}

export function requestReplan(reason: string) {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    replanToday(reason).catch(() => undefined);
    pending = null;
  }, 30_000);
}
