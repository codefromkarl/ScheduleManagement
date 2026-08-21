import { config } from "dotenv";
config({ path: ".env.local" });
import webpush from "web-push";
import { and, eq, lte, lt } from "drizzle-orm";
import { getDb } from "@/server/db";
import { pushSubscriptions, reminders } from "@/server/db/schema";
import { pwaIsConfigured } from "@/server/qq/config";
import { configuredReminderChannels, dailySummaryTime, reminderMessage, REMINDER_WORKSPACE_ID, todayInShanghai } from "@/server/reminders";
import { recordWorkerHealth } from "@/server/worker-health";

if (!pwaIsConfigured()) {
  console.error("[goalset-pwa-worker] NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be configured");
  process.exitCode = 1;
} else {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  async function ensureDailySummary() {
    const db = getDb();
    const date = todayInShanghai();
    const channels = configuredReminderChannels();
    if (!channels.includes("pwa")) return;
    await db.insert(reminders).values({ id: `daily-summary:${date}:pwa`, workspaceId: REMINDER_WORKSPACE_ID, kind: "daily_summary", channel: "pwa", scheduledAt: dailySummaryTime(date), status: "pending", dedupeKey: `daily-summary:${date}:pwa` }).onConflictDoNothing();
  }

  async function dispatch() {
    try {
      const db = getDb();
      await recordWorkerHealth("pwa", "running").catch(() => undefined);
      await ensureDailySummary();
      await db.update(reminders).set({ status: "pending", error: "上次发送进程中断，已重新排队", updatedAt: new Date() }).where(and(eq(reminders.status, "sending"), eq(reminders.channel, "pwa"), lt(reminders.updatedAt, new Date(Date.now() - 5 * 60_000))));
      const due = await db.select().from(reminders).where(and(eq(reminders.status, "pending"), eq(reminders.channel, "pwa"), lte(reminders.scheduledAt, new Date())));
      const subscriptions = await db.select().from(pushSubscriptions);
      for (const reminder of due) {
        const [claimed] = await db.update(reminders).set({ status: "sending", updatedAt: new Date() }).where(and(eq(reminders.id, reminder.id), eq(reminders.status, "pending"))).returning({ id: reminders.id });
        if (!claimed) continue;
        if (subscriptions.length === 0) {
          await db.update(reminders).set({ status: "failed", error: "No PWA subscriptions", updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
          continue;
        }
        try {
          await Promise.all(subscriptions.map((subscription) => webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: "goalset 提醒", body: reminderMessage(reminder.kind, reminder.taskId), url: "/" }))));
          await db.update(reminders).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
        } catch (error) {
          await db.update(reminders).set({ status: "failed", error: error instanceof Error ? error.message : "unknown error", updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
        }
      }
      await recordWorkerHealth("pwa", "success").catch(() => undefined);
    } catch (error) {
      await recordWorkerHealth("pwa", "error", error instanceof Error ? error.message : "unknown error").catch(() => undefined);
      console.error("[goalset-pwa-worker] dispatch failed", error instanceof Error ? error.message : error);
    }
  }

  void dispatch();
  const timer = setInterval(() => { void dispatch(); }, 30_000);
  const stop = () => { clearInterval(timer); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
