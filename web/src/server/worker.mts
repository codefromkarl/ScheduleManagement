import { config } from "dotenv";
config({ path: ".env.local" });
import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { and, desc, eq, lte, lt } from "drizzle-orm";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import type { ScheduleTask } from "@/features/schedule/domain/types";
import { evaluateDailySummary } from "@/features/schedule/domain/reminder-policy";
import { parseScheduleCommand } from "@/server/ai/provider";
import { qqConfigError, qqIsConfigured } from "@/server/qq/config";
import { parseQqCommandMode } from "@/server/qq/command-mode";
import { getDb } from "@/server/db";
import { commandReceipts, reminders } from "@/server/db/schema";
import { dailySummaryTime, reminderMessage, REMINDER_WORKSPACE_ID, todayInShanghai } from "@/server/reminders";
import { recordWorkerHealth } from "@/server/worker-health";

async function ensureDailySummary() {
  const db = getDb();
  const date = todayInShanghai();
  const scheduledAt = dailySummaryTime(date);
  const snapshot = await getActiveScheduleStore().getSnapshot(date);
  const decision = evaluateDailySummary(snapshot);
  if (!decision.eligible) return;
  await db.insert(reminders).values({ id: `daily-summary:${date}:qq`, workspaceId: REMINDER_WORKSPACE_ID, kind: "daily_summary", channel: "qq", scheduledAt, status: "pending", dedupeKey: `daily-summary:${date}:qq`, importanceReasons: decision.reasons }).onConflictDoNothing();
}

async function dispatchReminders(bot: QQBot) {
  try {
    const db = getDb();
    await recordWorkerHealth("qq", "running").catch(() => undefined);
    await ensureDailySummary();
    await db.update(reminders).set({ status: "pending", error: "上次发送进程中断，已重新排队", updatedAt: new Date() }).where(and(eq(reminders.status, "sending"), eq(reminders.channel, "qq"), lt(reminders.updatedAt, new Date(Date.now() - 5 * 60_000))));
    const due = await db.select().from(reminders).where(and(eq(reminders.status, "pending"), eq(reminders.channel, "qq"), lte(reminders.scheduledAt, new Date())));
    for (const reminder of due) {
      const [claimed] = await db.update(reminders).set({ status: "sending", updatedAt: new Date() }).where(and(eq(reminders.id, reminder.id), eq(reminders.status, "pending"))).returning({ id: reminders.id });
      if (!claimed) continue;
      try {
        await bot.sendText({ scope: "c2c", targetId: process.env.QQBOT_OWNER_USER_ID! }, reminderMessage(reminder.kind, reminder.taskId, reminder.importanceReasons ?? []));
        await db.update(reminders).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
      } catch (error) {
        await db.update(reminders).set({ status: "failed", error: error instanceof Error ? error.message : "unknown error", updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
      }
    }
    await recordWorkerHealth("qq", "success").catch(() => undefined);
  } catch (error) {
    await recordWorkerHealth("qq", "error", error instanceof Error ? error.message : "unknown error").catch(() => undefined);
    throw error;
  }
}

async function claimCommand(messageId: string, senderId: string) {
  const [receipt] = await getDb().insert(commandReceipts).values({ id: crypto.randomUUID(), workspaceId: REMINDER_WORKSPACE_ID, channel: "qq", externalMessageId: messageId, senderId, status: "received" }).onConflictDoNothing().returning();
  return receipt;
}

type PendingCommand = { kind: "insert"; task: ScheduleTask; optimize: true } | { kind: "reschedule"; taskId: string; date: string; startMinutes: number; optimize: true };

async function pendingConfirmation(senderId: string) {
  const [receipt] = await getDb().select().from(commandReceipts).where(and(eq(commandReceipts.workspaceId, REMINDER_WORKSPACE_ID), eq(commandReceipts.channel, "qq"), eq(commandReceipts.senderId, senderId), eq(commandReceipts.status, "pending_confirmation"))).orderBy(desc(commandReceipts.createdAt)).limit(1);
  if (!receipt?.payload || typeof receipt.payload !== "object") return { receipt: undefined, command: undefined };
  const payload = receipt.payload as { kind?: string; task?: ScheduleTask; taskId?: string; date?: string; startMinutes?: number; optimize?: boolean };
  if (payload.kind === "reschedule" && payload.optimize === true && payload.taskId && payload.date && typeof payload.startMinutes === "number") return { receipt, command: { kind: "reschedule" as const, taskId: payload.taskId, date: payload.date, startMinutes: payload.startMinutes, optimize: true as const } };
  if (payload.kind === "insert" && payload.optimize === true && payload.task) return { receipt, command: { kind: "insert" as const, task: payload.task, optimize: true as const } };
  return { receipt: undefined, command: undefined };
}

async function updateReceipt(id: string, status: "pending_confirmation" | "processed" | "failed", responseText: string, payload?: unknown) {
  await getDb().update(commandReceipts).set({ status, responseText, ...(payload ? { payload } : {}), updatedAt: new Date() }).where(eq(commandReceipts.id, id));
}

if (!qqIsConfigured()) {
  console.error(`[goalset-worker] ${qqConfigError()}`);
  process.exitCode = 1;
} else {
  const bot = new QQBot({
    appId: process.env.QQBOT_APP_ID!,
    appSecret: process.env.QQBOT_APP_SECRET!,
    accountId: "goalset-personal",
    tokenPrefetch: "sync",
    logger: {
      debug: (message) => console.debug("[qq]", message),
      info: (message) => console.info("[qq]", message),
      warn: (message) => console.warn("[qq]", message),
      error: (message) => console.error("[qq]", message),
    },
  });
  const pendingTasks = new Map<string, PendingCommand>();

  bot.on("ready", () => { console.info("[goalset-worker] QQ Bot ready"); void recordWorkerHealth("qq", "running"); });
  bot.on("error", (error) => { console.error("[goalset-worker] QQ Bot error", error.message); void recordWorkerHealth("qq", "error", error.message); });
  bot.on("message", async (_context, message) => {
    if (message.kind !== "c2c" || message.senderId !== process.env.QQBOT_OWNER_USER_ID) return;
    const receipt = await claimCommand(String(message.messageId), String(message.senderId));
    if (!receipt) return;
    const date = todayInShanghai();
    const store = getActiveScheduleStore();
    const text = message.content.trim();
    const { optimize, commandText } = parseQqCommandMode(text);

    try {
      if (text === "确认") {
        const pendingRecord = await pendingConfirmation(String(message.senderId));
        const previousCommand = pendingRecord.command ?? pendingTasks.get(String(message.senderId));
        if (!previousCommand) {
          const responseText = "当前没有待确认的日程调整。";
          await bot.sendText(message.replyTarget, responseText);
          await updateReceipt(receipt.id, "processed", responseText);
          return;
        }
        const result = previousCommand.kind === "reschedule"
          ? await store.rescheduleTask(previousCommand.taskId, previousCommand.date, previousCommand.startMinutes, { confirm: true, mode: "optimize", source: "qq-optimize" })
          : await store.confirmTask(previousCommand.task, { mode: "optimize", source: "qq-optimize" });
        const responseText = result.proposal.decision === "auto" ? "已确认，日程已调整。" : "确认失败，原日程没有改变。";
        pendingTasks.delete(String(message.senderId));
        await bot.sendText(message.replyTarget, responseText);
        if (pendingRecord.receipt) await updateReceipt(pendingRecord.receipt.id, "processed", responseText);
        await updateReceipt(receipt.id, "processed", responseText);
        return;
      }
      if (optimize && !commandText) {
        const responseText = "请在“优化日程”后说明要安排或调整的任务。";
        await bot.sendText(message.replyTarget, responseText);
        await updateReceipt(receipt.id, "processed", responseText);
        return;
      }
      const snapshot = await store.getSnapshot(date);
      const plan = await parseScheduleCommand(commandText, date, snapshot);
      if (plan.operation === "reschedule_task" && plan.targetTaskId && plan.targetStartMinutes !== null && !plan.needsClarification) {
        const targetDate = plan.targetDate ?? date;
        const result = await store.rescheduleTask(plan.targetTaskId, targetDate, plan.targetStartMinutes, { mode: optimize ? "optimize" : "rules", source: optimize ? "qq-optimize" : "qq" });
        if (result.proposal.decision === "needs_confirmation") {
          const command: PendingCommand = { kind: "reschedule", taskId: plan.targetTaskId, date: targetDate, startMinutes: plan.targetStartMinutes, optimize: true };
          pendingTasks.set(message.senderId, command);
          const responseText = `${plan.reply}\n需要移动弹性任务，请回复“确认”执行；原日程暂未改变。`;
          await updateReceipt(receipt.id, "pending_confirmation", responseText, command);
          await bot.sendText(message.replyTarget, responseText);
        } else if (result.proposal.decision === "auto") {
          const responseText = `${plan.reply}\n已完成改期。`;
          await bot.sendText(message.replyTarget, responseText);
          await updateReceipt(receipt.id, "processed", responseText);
        } else {
          const responseText = result.proposal.reasons.join(" ");
          await bot.sendText(message.replyTarget, responseText);
          await updateReceipt(receipt.id, "processed", responseText);
        }
        return;
      }
      if (plan.needsClarification || !plan.task) {
        if (plan.operation === "update_task" && plan.targetTaskId && plan.update && !plan.needsClarification) {
          const changes = Object.fromEntries(Object.entries(plan.update).filter(([, value]) => value !== null)) as { status?: "todo" | "doing" | "blocked" | "done"; priority?: "low" | "normal" | "high"; notes?: string };
          const updatedSnapshot = await store.updateTask(plan.targetTaskId, changes, { source: "qq", originalCommand: message.content });
          const responseText = `${plan.reply}\n已更新任务。`;
          await bot.sendText(message.replyTarget, responseText);
          await updateReceipt(receipt.id, "processed", responseText);
          void updatedSnapshot;
          return;
        }
        const responseText = plan.clarifyingQuestion ?? plan.reply;
        await bot.sendText(message.replyTarget, responseText);
        await updateReceipt(receipt.id, "processed", responseText);
        return;
      }
      const task: ScheduleTask = {
        id: `qq-${message.messageId}`,
        date: plan.targetDate ?? date,
        status: "todo",
        reminderPolicy: "auto",
        movable: plan.task.kind !== "fixed",
        ...plan.task,
        preferredStartMinutes: plan.task.preferredStartMinutes ?? undefined,
        deadlineMinutes: plan.task.deadlineMinutes ?? undefined,
      };
      const result = await store.insertTask(task, { mode: optimize ? "optimize" : "rules", source: optimize ? "qq-optimize" : "qq" });
      if (result.proposal.decision === "needs_confirmation") {
        pendingTasks.set(message.senderId, { kind: "insert", task, optimize: true });
        const responseText = `${plan.reply}\n需要移动弹性任务，请回复“确认”执行；原日程暂未改变。`;
        await updateReceipt(receipt.id, "pending_confirmation", responseText, { kind: "insert", task, optimize: true });
        await bot.sendText(message.replyTarget, responseText);
      } else if (result.proposal.decision === "auto") {
        const responseText = `${plan.reply}\n已安排到 ${result.proposal.placement?.startMinutes} 分钟。`;
        await bot.sendText(message.replyTarget, responseText);
        await updateReceipt(receipt.id, "processed", responseText);
      } else {
        const responseText = `${plan.reply}\n当前没有安全空档，已保存到待安排，原日程未移动。`;
        await bot.sendText(message.replyTarget, responseText);
        await updateReceipt(receipt.id, "processed", responseText);
      }
    } catch (error) {
      console.error("[goalset-worker] command failed", error instanceof Error ? error.message : error);
      const responseText = "处理失败，原日程没有改变。";
      await updateReceipt(receipt.id, "failed", responseText);
      await bot.sendText(message.replyTarget, responseText);
    }
  });

  const reminderTimer = setInterval(() => { void dispatchReminders(bot); }, 30_000);

  const abort = new AbortController();
  process.once("SIGINT", () => { clearInterval(reminderTimer); abort.abort(); });
  process.once("SIGTERM", () => { clearInterval(reminderTimer); abort.abort(); });
  void dispatchReminders(bot);
  bot.start(abort.signal).catch((error) => {
    console.error("[goalset-worker] stopped with error", error);
    process.exitCode = 1;
  });
}
