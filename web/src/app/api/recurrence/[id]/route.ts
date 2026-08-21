import { and, eq, inArray, like } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { occurrenceOverrides, recurrenceRules, reminders, scheduleBlocks, tasks } from "@/server/db/schema";
import { scheduleDateSchema } from "@/features/schedule/data/contract";
import { applyOccurrenceOverrides, generateOccurrenceDates } from "@/features/schedule/domain/recurrence";

const querySchema = z.object({ from: scheduleDateSchema, to: scheduleDateSchema });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "from/to are required" } }, { status: 400 });
  const db = getDb();
  const rows = await db.select({ rule: recurrenceRules, task: tasks }).from(recurrenceRules).innerJoin(tasks, eq(tasks.id, recurrenceRules.taskId)).where(and(eq(recurrenceRules.id, id), eq(tasks.workspaceId, "personal")));
  if (rows.length === 0) return NextResponse.json({ error: { code: "RECURRENCE_NOT_FOUND", message: "重复规则不存在" } }, { status: 404 });
  const { rule, task } = rows[0];
  const overrides = await db.select().from(occurrenceOverrides).where(eq(occurrenceOverrides.recurrenceId, id));
  const dates = generateOccurrenceDates({ frequency: rule.frequency, weekdays: rule.weekdays ?? undefined, startDate: rule.startDate, endDate: rule.endDate ?? undefined }, query.data.from, query.data.to);
  return NextResponse.json({ recurrenceId: id, taskId: task.id, title: task.title, occurrences: applyOccurrenceOverrides(dates, overrides.map((override) => ({ occurrenceDate: override.occurrenceDate, action: override.action, startMinutes: override.startMinutes, durationMinutes: override.durationMinutes, note: override.note }))) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDb();
  const rows = await db.select({ id: recurrenceRules.id, taskId: recurrenceRules.taskId }).from(recurrenceRules).innerJoin(tasks, eq(tasks.id, recurrenceRules.taskId)).where(and(eq(recurrenceRules.id, id), eq(tasks.workspaceId, "personal")));
  if (rows.length === 0) return NextResponse.json({ error: { code: "RECURRENCE_NOT_FOUND", message: "重复规则不存在" } }, { status: 404 });
  const occurrenceRows = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, "personal"), eq(tasks.source, "recurrence"), like(tasks.id, `${rows[0].taskId}@%`)));
  const occurrenceIds = occurrenceRows.map((row) => row.id);
  await db.transaction(async (tx) => {
    await tx.delete(occurrenceOverrides).where(eq(occurrenceOverrides.recurrenceId, id));
    if (occurrenceIds.length > 0) {
      await tx.delete(reminders).where(and(eq(reminders.workspaceId, "personal"), inArray(reminders.taskId, occurrenceIds)));
      await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, "personal"), inArray(scheduleBlocks.taskId, occurrenceIds)));
      await tx.delete(tasks).where(and(eq(tasks.workspaceId, "personal"), inArray(tasks.id, occurrenceIds)));
    }
    await tx.delete(recurrenceRules).where(eq(recurrenceRules.id, id));
  });
  return NextResponse.json({ ok: true });
}
