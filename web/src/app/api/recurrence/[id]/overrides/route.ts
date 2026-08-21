import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { occurrenceOverrides, recurrenceRules } from "@/server/db/schema";
import { scheduleDateSchema, scheduleMinutesSchema } from "@/features/schedule/data/contract";

const overrideSchema = z.object({
  occurrenceDate: scheduleDateSchema,
  action: z.enum(["skip", "move", "override"]),
  startMinutes: scheduleMinutesSchema.optional(),
  durationMinutes: scheduleMinutesSchema.refine((value) => value > 0).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = overrideSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "单次例外无效" } }, { status: 400 });
  const db = getDb();
  const rules = await db.select({ id: recurrenceRules.id }).from(recurrenceRules).where(eq(recurrenceRules.id, id));
  if (rules.length === 0) return NextResponse.json({ error: { code: "RECURRENCE_NOT_FOUND", message: "重复规则不存在" } }, { status: 404 });
  const [override] = await db.insert(occurrenceOverrides).values({ id: crypto.randomUUID(), recurrenceId: id, occurrenceDate: parsed.data.occurrenceDate, action: parsed.data.action, startMinutes: parsed.data.startMinutes, durationMinutes: parsed.data.durationMinutes, note: parsed.data.note }).returning();
  return NextResponse.json({ override }, { status: 201 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const occurrenceDate = scheduleDateSchema.safeParse(new URL(request.url).searchParams.get("occurrenceDate"));
  if (!occurrenceDate.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "occurrenceDate is required" } }, { status: 400 });
  await getDb().delete(occurrenceOverrides).where(and(eq(occurrenceOverrides.recurrenceId, id), eq(occurrenceOverrides.occurrenceDate, occurrenceDate.data)));
  return NextResponse.json({ ok: true });
}
