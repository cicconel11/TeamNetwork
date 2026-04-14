import { z } from "zod";

export const createTaskSchema = z.object({
  pair_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
});

export type CreateTask = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
});

export type UpdateTask = z.infer<typeof updateTaskSchema>;

export const createMeetingSchema = z.object({
  pair_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  scheduled_at: z.string().datetime({ offset: true }),
  duration_minutes: z.number().int().min(15).max(480).default(60),
  platform: z.enum(['google_meet', 'zoom']),
});

export type CreateMeeting = z.infer<typeof createMeetingSchema>;
