import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { reminders } from "@/server/db/schema";

export async function GET() {
  const rows = await getDb().select({ id: reminders.id, taskId: reminders.taskId, blockId: reminders.blockId, kind: reminders.kind, channel: reminders.channel, importanceReasons: reminders.importanceReasons, scheduledAt: reminders.scheduledAt, status: reminders.status, error: reminders.error, sentAt: reminders.sentAt, receivedAt: reminders.receivedAt, createdAt: reminders.createdAt }).from(reminders).where(eq(reminders.workspaceId, "personal")).orderBy(desc(reminders.createdAt)).limit(30);
  return NextResponse.json({ reminders: rows });
}
