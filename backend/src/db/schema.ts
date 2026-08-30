import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  notes: text('notes').notNull().default(''),
  type: text('type', { enum: ['ONE_TIME', 'RECURRING', 'HABIT'] }).notNull().default('ONE_TIME'),
  status: text('status', { enum: ['DRAFT', 'PENDING', 'COMPLETED', 'SKIPPED', 'ARCHIVED'] }).notNull().default('PENDING'),
  priority: integer('priority').notNull().default(3),
  estimatedMinutes: integer('estimated_minutes').notNull().default(30),
  deadline: text('deadline'),
  earliestStart: text('earliest_start'),
  preferredTime: text('preferred_time', { enum: ['ANY', 'MORNING', 'AFTERNOON', 'EVENING'] }).notNull().default('ANY'),
  energy: text('energy', { enum: ['LOW', 'MEDIUM', 'HIGH'] }).notNull().default('MEDIUM'),
  splittable: integer('splittable', { mode: 'boolean' }).notNull().default(false),
  minimumChunkMinutes: integer('minimum_chunk_minutes').notNull().default(30),
  recurrenceRule: text('recurrence_rule'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const taskOccurrences = sqliteTable('task_occurrences', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  occurrenceDate: text('occurrence_date').notNull(),
  status: text('status').notNull().default('PENDING'),
  completedAt: text('completed_at'),
});

export const scheduleBlocks = sqliteTable('schedule_blocks', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  start: text('start').notNull(),
  end: text('end').notNull(),
  calendarEventId: text('calendar_event_id'),
  state: text('state').notNull().default('PLANNED'),
  planRunId: text('plan_run_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey().default(1),
  timezone: text('timezone').notNull(),
  dayStart: text('day_start').notNull().default('08:00'),
  dayEnd: text('day_end').notNull().default('22:00'),
  workingDays: text('working_days').notNull().default('[1,2,3,4,5,6,7]'),
  eventBufferMinutes: integer('event_buffer_minutes').notNull().default(10),
  maximumPlannedMinutes: integer('maximum_planned_minutes').notNull().default(480),
  briefingTime: text('briefing_time').notNull().default('08:00'),
  onboardingComplete: integer('onboarding_complete', { mode: 'boolean' }).notNull().default(false),
  autoPlanEnabled: integer('auto_plan_enabled', { mode: 'boolean' }).notNull().default(false),
  agentCalendarId: text('agent_calendar_id'),
  includeNewsInBriefing: integer('include_news_in_briefing', { mode: 'boolean' }).notNull().default(true),
  newsTopics: text('news_topics').notNull().default('["artificial intelligence","software and technology","startups and business"]'),
  updatedAt: text('updated_at').notNull(),
});

export const webSearchRuns = sqliteTable('web_search_runs', {
  id: text('id').primaryKey(),
  query: text('query').notNull(),
  provider: text('provider').notNull(),
  resultUrls: text('result_urls').notNull(),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  source: text('source').notNull(),
  createdAt: text('created_at').notNull(),
});

export const planRuns = sqliteTable('plan_runs', {
  id: text('id').primaryKey(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
});

export const briefings = sqliteTable('briefings', {
  id: text('id').primaryKey(),
  briefingDate: text('briefing_date').notNull().unique(),
  content: text('content').notNull(),
  deliveryStatus: text('delivery_status').notNull().default('PENDING'),
  sentAt: text('sent_at'),
  createdAt: text('created_at').notNull(),
});

export const agentActions = sqliteTable('agent_actions', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  action: text('action').notNull(),
  input: text('input').notNull(),
  result: text('result').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});
