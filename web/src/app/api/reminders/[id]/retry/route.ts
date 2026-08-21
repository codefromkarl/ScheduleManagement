import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { reminders } from "@/server/db/schema";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const [reminder] = await getDb().update(reminders).set({ status: "pending", scheduledAt: new Date(), sentAt: null, error: null, updatedAt: new Date() }).where(and(eq(reminders.id, id), eq(reminders.workspaceId, "personal"), eq(reminders.status, "failed"))).returning({ id: reminders.id, status: reminders.status });
  if (!reminder) return NextResponse.json({ error: { code: "REMINDER_NOT_RETRYABLE", message: "提醒不存在或当前不能重试" } }, { status: 409 });
  return NextResponse.json({ reminder });
}
