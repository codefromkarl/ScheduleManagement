import { z } from "zod";

export const scheduleDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD").refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "date must be a real calendar date");
export const scheduleMinutesSchema = z.number().int().min(0).max(1440).refine((value) => value % 15 === 0, "time must use 15-minute increments");

export const scheduleTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  date: scheduleDateSchema,
  kind: z.enum(["fixed", "flexible", "floating"]),
  priority: z.enum(["low", "normal", "high"]),
  status: z.enum(["todo", "doing", "blocked", "done"]),
  estimatedMinutes: scheduleMinutesSchema.refine((value) => value > 0, "duration must be positive"),
  movable: z.boolean(),
  preferredStartMinutes: scheduleMinutesSchema.optional(),
  deadlineMinutes: scheduleMinutesSchema.optional(),
  projectId: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
});

const scheduledBlockSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  date: scheduleDateSchema,
  startMinutes: scheduleMinutesSchema,
  durationMinutes: scheduleMinutesSchema.refine((value) => value > 0, "duration must be positive"),
  kind: z.enum(["fixed", "flexible", "floating"]),
  movable: z.boolean(),
  title: z.string().min(1),
  priority: z.enum(["low", "normal", "high"]).optional(),
  projectId: z.string().min(1).optional(),
});

const availabilitySchema = z.object({
  date: scheduleDateSchema,
  startMinutes: scheduleMinutesSchema,
  endMinutes: scheduleMinutesSchema,
});

const unavailableSchema = availabilitySchema.extend({ reason: z.string().min(1) });

export const scheduleSnapshotSchema = z.object({
  date: scheduleDateSchema,
  tasks: z.array(scheduleTaskSchema),
  blocks: z.array(scheduledBlockSchema),
  availability: z.array(availabilitySchema),
  unavailable: z.array(unavailableSchema),
  bufferMinutes: scheduleMinutesSchema,
  defaultDurationMinutes: scheduleMinutesSchema.refine((value) => value > 0).optional(),
});

export const scheduleCommandSchema = z.object({ task: scheduleTaskSchema });
