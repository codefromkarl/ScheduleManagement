import { z } from "zod";

export const qqTestReminderRequestSchema = z.object({
  delayMinutes: z.number().int().min(0).max(60).default(0),
});

export function qqTestReminderTime(delayMinutes: number, now = new Date()) {
  return new Date(now.getTime() + delayMinutes * 60_000);
}
