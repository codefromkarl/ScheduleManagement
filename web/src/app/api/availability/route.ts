import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleDateSchema, scheduleMinutesSchema } from "@/features/schedule/data/contract";
import { availabilityRules, unavailableWindows, workspaces } from "@/server/db/schema";
import { getDb } from "@/server/db";

const weeklyRuleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinutes: scheduleMinutesSchema,
  endMinutes: scheduleMinutesSchema,
  enabled: z.boolean(),
}).refine((value) => !value.enabled || value.endMinutes > value.startMinutes, "工作时间必须在结束前开始");

const weeklySchema = z.object({ rules: z.array(weeklyRuleSchema).length(7) }).superRefine((value, context) => {
  if (new Set(value.rules.map((rule) => rule.weekday)).size !== 7) context.addIssue({ code: "custom", message: "必须为每个星期提供一条规则", path: ["rules"] });
});

async function ensureWorkspace() {
  await getDb().insert(workspaces).values({ id: "personal", name: "个人工作区", timezone: "Asia/Shanghai" }).onConflictDoNothing();
}

export async function GET() {
  await ensureWorkspace();
  const db = getDb();
  const [weekly, unavailable] = await Promise.all([
    db.select({ weekday: availabilityRules.weekday, startMinutes: availabilityRules.startMinutes, endMinutes: availabilityRules.endMinutes, enabled: availabilityRules.enabled }).from(availabilityRules).where(eq(availabilityRules.workspaceId, "personal")).orderBy(asc(availabilityRules.weekday)),
    db.select({ id: unavailableWindows.id, date: unavailableWindows.date, startMinutes: unavailableWindows.startMinutes, endMinutes: unavailableWindows.endMinutes, reason: unavailableWindows.reason }).from(unavailableWindows).where(eq(unavailableWindows.workspaceId, "personal")).orderBy(asc(unavailableWindows.date), asc(unavailableWindows.startMinutes)).limit(30),
  ]);
  return NextResponse.json({ weekly, unavailable });
}

export async function PUT(request: Request) {
  const parsed = weeklySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "工作时间规则无效" } }, { status: 400 });
  await ensureWorkspace();
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const rule of parsed.data.rules) {
      await tx.insert(availabilityRules).values({ id: `availability:${rule.weekday}`, workspaceId: "personal", ...rule }).onConflictDoUpdate({ target: availabilityRules.id, set: { startMinutes: rule.startMinutes, endMinutes: rule.endMinutes, enabled: rule.enabled, updatedAt: new Date() } });
    }
  });
  return NextResponse.json({ ok: true, weekly: parsed.data.rules });
}

const unavailableSchema = z.object({ date: scheduleDateSchema, startMinutes: scheduleMinutesSchema, endMinutes: scheduleMinutesSchema, reason: z.string().min(1).max(100) }).refine((value) => value.endMinutes > value.startMinutes, "不可用时间必须在结束前开始");

export async function POST(request: Request) {
  const parsed = unavailableSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "不可用时间无效" } }, { status: 400 });
  await ensureWorkspace();
  const [window] = await getDb().insert(unavailableWindows).values({ id: crypto.randomUUID(), workspaceId: "personal", ...parsed.data }).returning({ id: unavailableWindows.id, date: unavailableWindows.date, startMinutes: unavailableWindows.startMinutes, endMinutes: unavailableWindows.endMinutes, reason: unavailableWindows.reason });
  return NextResponse.json({ window }, { status: 201 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "id is required" } }, { status: 400 });
  const deleted = await getDb().delete(unavailableWindows).where(and(eq(unavailableWindows.id, id), eq(unavailableWindows.workspaceId, "personal"))).returning({ id: unavailableWindows.id });
  if (deleted.length === 0) return NextResponse.json({ error: { code: "UNAVAILABLE_NOT_FOUND", message: "不可用时间不存在" } }, { status: 404 });
  return NextResponse.json({ ok: true });
}
