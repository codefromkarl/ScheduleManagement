import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { pushSubscriptions, reminders, workspaces } from "@/server/db/schema";
import { pwaIsConfigured, reminderChannelIsEnabled } from "@/server/qq/config";

export async function POST() {
  if (!reminderChannelIsEnabled("pwa")) return NextResponse.json({ error: { code: "PWA_NOT_ENABLED", message: "当前仅启用 QQ 提醒" } }, { status: 409 });
  if (!pwaIsConfigured()) return NextResponse.json({ error: { code: "PWA_NOT_CONFIGURED", message: "尚未配置 Web Push 凭据" } }, { status: 409 });
  const db = getDb();
  const subscriptions = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.workspaceId, "personal"));
  if (subscriptions.length === 0) return NextResponse.json({ error: { code: "PWA_NOT_SUBSCRIBED", message: "当前还没有已订阅的设备" } }, { status: 409 });
  const reminderId = crypto.randomUUID();
  await db.insert(workspaces).values({ id: "personal", name: "个人工作区", timezone: "Asia/Shanghai" }).onConflictDoNothing();
  await db.insert(reminders).values({ id: reminderId, workspaceId: "personal", kind: "test", channel: "pwa", scheduledAt: new Date(), status: "pending", dedupeKey: `pwa-test:${reminderId}` });
  return NextResponse.json({ reminderId, status: "pending" }, { status: 202 });
}
