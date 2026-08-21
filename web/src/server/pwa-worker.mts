import { config } from "dotenv";
config({ path: ".env.local" });
import webpush from "web-push";
import { and, eq, inArray, lte, lt } from "drizzle-orm";
import { getDb } from "@/server/db";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import { evaluateDailySummary } from "@/features/schedule/domain/reminder-policy";
import { pushSubscriptions, reminders } from "@/server/db/schema";
import { pwaIsConfigured, reminderChannelIsEnabled } from "@/server/qq/config";
import { dailySummaryTime, reminderMessage, REMINDER_WORKSPACE_ID, todayInShanghai } from "@/server/reminders";
import { recordWorkerHealth } from "@/server/worker-health";
import { deliverPwaPayload } from "@/server/pwa-delivery";

if (!reminderChannelIsEnabled("pwa")) {
  console.error("[goalset-pwa-worker] PWA reminder channel is disabled by REMINDER_CHANNELS");
  process.exitCode = 1;
} else if (!pwaIsConfigured()) {
  console.error("[goalset-pwa-worker] NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be configured");
  process.exitCode = 1;
} else {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  async function ensureDailySummary() {
    const db = getDb();
    const date = todayInShanghai();
    const snapshot = await getActiveScheduleStore().getSnapshot(date);
    const decision = evaluateDailySummary(snapshot);
    if (!decision.eligible) return;
    await db.insert(reminders).values({ id: `daily-summary:${date}:pwa`, workspaceId: REMINDER_WORKSPACE_ID, kind: "daily_summary", channel: "pwa", scheduledAt: dailySummaryTime(date), status: "pending", dedupeKey: `daily-summary:${date}:pwa`, importanceReasons: decision.reasons }).onConflictDoNothing();
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
        const payload = JSON.stringify({ reminderId: reminder.id, title: "goalset 提醒", body: reminderMessage(reminder.kind, reminder.taskId, reminder.importanceReasons ?? [], "pwa"), url: "/" });
        const delivery = await deliverPwaPayload(subscriptions, payload, (subscription, body) => webpush.sendNotification(subscription, body));
        if (delivery.staleIds.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, delivery.staleIds));
        if (delivery.acceptedIds.length > 0) {
          await db.update(reminders).set({ status: "sent", sentAt: new Date(), error: null, updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
        } else {
          const error = delivery.errors.length > 0 ? delivery.errors.join("; ").slice(0, 1000) : "No active PWA subscriptions";
          await db.update(reminders).set({ status: "failed", error, updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
        }
      }
      await recordWorkerHealth("pwa", "success").catch(() => undefined);
    } catch (error) {
      await recordWorkerHealth("pwa", "error", error instanceof Error ? error.message : "unknown error").catch(() => undefined);
      console.error("[goalset-pwa-worker] dispatch failed", error instanceof Error ? error.message : error);
    }
  }

  if (process.env.PWA_WORKER_ONCE === "true") {
    void dispatch().then(() => process.exit(0), () => process.exit(1));
  } else {
    void dispatch();
    const timer = setInterval(() => { void dispatch(); }, 30_000);
    const stop = () => { clearInterval(timer); process.exit(0); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
