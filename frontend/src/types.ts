export type Task = {
  id: string; title: string; notes: string; type: 'ONE_TIME' | 'RECURRING' | 'HABIT';
  status: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'ARCHIVED'; priority: number;
  estimatedMinutes: number; deadline: string | null; preferredTime: string; createdAt: string;
};
export type Settings = {
  timezone: string; dayStart: string; dayEnd: string; workingDays: number[]; eventBufferMinutes: number;
  maximumPlannedMinutes: number; briefingTime: string; onboardingComplete: boolean; autoPlanEnabled: boolean;
  agentCalendarId: string | null; includeNewsInBriefing: boolean; newsTopics: string[];
};
export type SearchSource = { title: string; url: string; publishedAt?: string; provider: string };
export type ChatResponse = { reply: string; action: string; searched: boolean; searchStatus: 'not_needed' | 'success' | 'fallback' | 'unavailable'; sources: SearchSource[] };
export type PlanBlock = { id: string; taskId: string; start: string; end: string; state: string };
export type CalendarEvent = { start: string; end: string; title?: string };
export type CalendarAgentBlock = PlanBlock & { title: string };
export type Briefing = { id: string; briefingDate: string; content: string; deliveryStatus: string; sentAt: string | null };
