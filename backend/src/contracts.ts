import { z } from 'zod';

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).default(''),
  type: z.enum(['ONE_TIME', 'RECURRING', 'HABIT']).default('ONE_TIME'),
  priority: z.number().int().min(1).max(5).default(3),
  estimatedMinutes: z.number().int().min(5).max(720).default(30),
  deadline: z.iso.datetime({ offset: true }).nullable().default(null),
  earliestStart: z.iso.datetime({ offset: true }).nullable().default(null),
  preferredTime: z.enum(['ANY', 'MORNING', 'AFTERNOON', 'EVENING']).default('ANY'),
  energy: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  splittable: z.boolean().default(false),
  minimumChunkMinutes: z.number().int().min(5).max(180).default(30),
  recurrenceRule: z.string().max(500).nullable().default(null),
});

export const taskPatchSchema = taskInputSchema.partial().extend({
  status: z.enum(['DRAFT', 'PENDING', 'COMPLETED', 'SKIPPED', 'ARCHIVED']).optional(),
});

export const settingsSchema = z.object({
  timezone: z.string().min(1),
  dayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  dayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1),
  eventBufferMinutes: z.number().int().min(0).max(120),
  maximumPlannedMinutes: z.number().int().min(30).max(960),
  briefingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  onboardingComplete: z.boolean(),
  autoPlanEnabled: z.boolean(),
  includeNewsInBriefing: z.boolean().default(true),
  newsTopics: z.array(z.string().trim().min(1).max(80)).max(10).default(['artificial intelligence', 'software and technology', 'startups and business']),
});

export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskPatch = z.infer<typeof taskPatchSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;

export type BusyInterval = { start: string; end: string; title?: string };
export type PlannedBlock = { id: string; taskId: string; title: string; start: string; end: string };
