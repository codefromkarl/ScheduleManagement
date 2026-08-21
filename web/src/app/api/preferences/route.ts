import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { preferences, workspaces } from "@/server/db/schema";

const preferenceSchema = z.object({ key: z.enum(["bufferMinutes", "defaultDurationMinutes", "timezone"]), value: z.union([z.number(), z.string()]) });

export async function GET() {
  const rows = await getDb().select().from(preferences).where(eq(preferences.workspaceId, "personal"));
  return NextResponse.json({ preferences: rows.map((row) => ({ key: row.key, value: row.value, source: row.source, confidence: row.confidence })) });
}

export async function PUT(request: Request) {
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.key === "bufferMinutes" && (typeof parsed.data.value !== "number" || ![0, 15, 30].includes(parsed.data.value))) || (parsed.data.key === "defaultDurationMinutes" && (typeof parsed.data.value !== "number" || ![15, 30, 45, 60, 90, 120].includes(parsed.data.value)))) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "偏好值无效" } }, { status: 400 });
  }
  const db = getDb();
  await db.insert(workspaces).values({ id: "personal", name: "个人工作区", timezone: "Asia/Shanghai" }).onConflictDoNothing();
  await db.insert(preferences).values({ id: crypto.randomUUID(), workspaceId: "personal", key: parsed.data.key, value: parsed.data.value, source: "user", confidence: 1 }).onConflictDoUpdate({ target: [preferences.workspaceId, preferences.key], set: { value: parsed.data.value, source: "user", confidence: 1, updatedAt: new Date() } });
  return NextResponse.json({ ok: true, key: parsed.data.key, value: parsed.data.value });
}

export async function DELETE(request: Request) {
  const key = z.enum(["bufferMinutes", "defaultDurationMinutes", "timezone"]).safeParse(new URL(request.url).searchParams.get("key"));
  if (!key.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "偏好 key 无效" } }, { status: 400 });
  await getDb().delete(preferences).where(and(eq(preferences.workspaceId, "personal"), eq(preferences.key, key.data)));
  return NextResponse.json({ ok: true, key: key.data });
}
