import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { reminders, workspaces } from "@/server/db/schema";
import { qqIsConfigured, reminderChannelIsEnabled } from "@/server/qq/config";
import { qqTestReminderRequestSchema, qqTestReminderTime } from "@/server/qq/test-reminder";

export async function POST(request: Request) {
  if (!reminderChannelIsEnabled("qq")) return NextResponse.json({ error: { code: "QQ_NOT_ENABLED", message: "当前未启用 QQ 提醒" } }, { status: 409 });
  if (!qqIsConfigured()) return NextResponse.json({ error: { code: "QQ_NOT_CONFIGURED", message: "尚未配置 QQ Bot 凭据和所有者账号" } }, { status: 409 });
  const parsed = qqTestReminderRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "延迟分钟数必须是 0 到 60 的整数" } }, { status: 400 });
  const reminderId = crypto.randomUUID();
  const scheduledAt = qqTestReminderTime(parsed.data.delayMinutes);
  const db = getDb();
  await db.insert(workspaces).values({ id: "personal", name: "个人日程" }).onConflictDoNothing();
  await db.insert(reminders).values({ id: reminderId, workspaceId: "personal", kind: "test", channel: "qq", scheduledAt, status: "pending", dedupeKey: `qq-test:${reminderId}` });
  return NextResponse.json({ reminderId, status: "pending", scheduledAt }, { status: 202 });
}
