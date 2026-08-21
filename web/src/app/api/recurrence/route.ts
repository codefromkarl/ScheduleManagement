import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { recurrenceRules, tasks } from "@/server/db/schema";
import { scheduleDateSchema } from "@/features/schedule/data/contract";
import { generateOccurrenceDates } from "@/features/schedule/domain/recurrence";

const requestSchema = z.object({
  taskId: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "workday", "weekdays"]),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  startDate: scheduleDateSchema,
  endDate: scheduleDateSchema.optional(),
  timezone: z.string().min(1).default("Asia/Shanghai"),
}).refine((value) => !value.endDate || value.endDate >= value.startDate, { message: "结束日期不能早于开始日期", path: ["endDate"] });

export async function GET(request: Request) {
  const taskId = z.string().min(1).safeParse(new URL(request.url).searchParams.get("taskId"));
  if (!taskId.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "taskId is required" } }, { status: 400 });
  const rows = await getDb().select({ id: recurrenceRules.id, taskId: recurrenceRules.taskId, frequency: recurrenceRules.frequency, weekdays: recurrenceRules.weekdays, startDate: recurrenceRules.startDate, endDate: recurrenceRules.endDate, timezone: recurrenceRules.timezone }).from(recurrenceRules).innerJoin(tasks, eq(tasks.id, recurrenceRules.taskId)).where(and(eq(recurrenceRules.taskId, taskId.data), eq(tasks.workspaceId, "personal")));
  return NextResponse.json({ rules: rows });
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "重复规则无效" } }, { status: 400 });
  const db = getDb();
  const taskRows = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.workspaceId, "personal")));
  if (taskRows.length === 0) return NextResponse.json({ error: { code: "TASK_NOT_FOUND", message: "任务不存在" } }, { status: 404 });
  const id = crypto.randomUUID();
  await db.insert(recurrenceRules).values({ id, taskId: parsed.data.taskId, frequency: parsed.data.frequency, weekdays: parsed.data.weekdays, startDate: parsed.data.startDate, endDate: parsed.data.endDate, timezone: parsed.data.timezone });
  return NextResponse.json({ id, occurrences: generateOccurrenceDates(parsed.data, parsed.data.startDate, parsed.data.endDate ?? parsed.data.startDate) }, { status: 201 });
}
