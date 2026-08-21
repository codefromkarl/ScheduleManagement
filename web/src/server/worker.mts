import { config } from "dotenv";
config({ path: ".env.local" });
import { QQBot, type ReplyTarget } from "@tencent-connect/qqbot-nodejs";
import { and, eq, lte, lt } from "drizzle-orm";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import type { ScheduleTask } from "@/features/schedule/domain/types";
import { evaluateDailySummary } from "@/features/schedule/domain/reminder-policy";
import { parseScheduleCommand } from "@/server/ai/provider";
import { qqConfigError, qqInlineKeyboardIsEnabled, qqIsConfigured, reminderChannelIsEnabled, sanitizedQqError } from "@/server/qq/config";
import { parseQqCommandMode, parseQqControlCommand } from "@/server/qq/command-mode";
import { getDb } from "@/server/db";
import { commandReceipts, reminders } from "@/server/db/schema";
import { dailySummaryTime, reminderMessage, REMINDER_WORKSPACE_ID, todayInShanghai } from "@/server/reminders";
import { recordWorkerHealth } from "@/server/worker-health";
import {
  buildQqProposalPreview,
  cancelQqScheduleProposal,
  claimQqScheduleProposal,
  createQqScheduleProposal,
  findQqScheduleProposal,
  findQqSafeTimeCandidates,
  formatQqScheduleProposal,
  markQqScheduleProposalApplied,
  parseQqProposalAction,
  parseQqProposalButtonData,
  parseQqProposalEdit,
  qqProposalKeyboard,
  releaseQqScheduleProposal,
} from "@/server/qq/schedule-proposals";
import type { QqScheduleProposalIntent, QqScheduleProposalPreview } from "@/server/qq/schedule-proposal-types";
import { renderQqProposalPng, shouldRenderQqProposalImage } from "@/server/qq/schedule-proposal-image";

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
        await bot.sendText({ scope: "c2c", targetId: process.env.QQBOT_OWNER_USER_ID! }, reminderMessage(reminder.kind, reminder.taskId, reminder.importanceReasons ?? [], "qq"));
        await db.update(reminders).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
      } catch (error) {
        await db.update(reminders).set({ status: "failed", error: sanitizedQqError(error), updatedAt: new Date() }).where(eq(reminders.id, reminder.id));
      }
    }
    await recordWorkerHealth("qq", "success").catch(() => undefined);
  } catch (error) {
    await recordWorkerHealth("qq", "error", sanitizedQqError(error)).catch(() => undefined);
    throw error;
  }
}

async function claimCommand(messageId: string, senderId: string, channel = "qq") {
  const [receipt] = await getDb().insert(commandReceipts).values({ id: crypto.randomUUID(), workspaceId: REMINDER_WORKSPACE_ID, channel, externalMessageId: messageId, senderId, status: "received" }).onConflictDoNothing().returning();
  return receipt;
}

async function updateReceipt(id: string, status: "pending_confirmation" | "processed" | "failed", responseText: string, payload?: unknown) {
  await getDb().update(commandReceipts).set({ status, responseText, ...(payload ? { payload } : {}), updatedAt: new Date() }).where(eq(commandReceipts.id, id));
}

async function finishReceivedReceipt(id: string, responseText: string, payload?: unknown) {
  await getDb().update(commandReceipts).set({ status: "processed", responseText, ...(payload ? { payload } : {}), updatedAt: new Date() }).where(and(eq(commandReceipts.id, id), eq(commandReceipts.status, "received")));
}

async function createProposal(ownerId: string, sourceReceiptId: string, intent: QqScheduleProposalIntent) {
  const store = getActiveScheduleStore();
  const preview = await buildQqProposalPreview(store, intent);
  const created = await createQqScheduleProposal({ ownerId, sourceReceiptId, intent, preview });
  const reply = formatQqScheduleProposal(created.proposal.publicId, preview, created.superseded > 0);
  await updateReceipt(sourceReceiptId, "pending_confirmation", reply, { kind: "schedule_proposal", proposalId: created.proposal.id, publicId: created.proposal.publicId, state: "pending" });
  return { ...created, reply };
}

async function sendProposalReply(bot: QQBot, target: ReplyTarget, reply: string, publicId: string, decision: QqScheduleProposalPreview["decision"]) {
  const proposal = await findQqScheduleProposal(process.env.QQBOT_OWNER_USER_ID!, publicId);
  if (proposal?.status === "pending" && shouldRenderQqProposalImage(proposal.preview)) {
    try {
      const buffer = await renderQqProposalPng(proposal.preview);
      await bot.sendImage(target, { buffer }, { content: `日程关系预览 · ${publicId}` });
    } catch (error) {
      console.warn("[goalset-worker] QQ proposal image unavailable, falling back to text", sanitizedQqError(error));
    }
  }
  if (!qqInlineKeyboardIsEnabled()) {
    await bot.sendText(target, reply);
    return;
  }
  try {
    await bot.sendTextWithKeyboard(target, reply, qqProposalKeyboard(publicId, decision));
  } catch (error) {
    console.warn("[goalset-worker] QQ inline keyboard unavailable, falling back to text", sanitizedQqError(error));
    await bot.sendText(target, reply);
  }
}

async function sendActionReply(bot: QQBot, ownerId: string, target: ReplyTarget, reply: string) {
  const active = await findQqScheduleProposal(ownerId);
  if (active?.status === "pending" && reply.includes(active.publicId)) {
    await sendProposalReply(bot, target, reply, active.publicId, active.preview.decision);
    return;
  }
  await bot.sendText(target, reply);
}

function terminalProposalReply(status?: string) {
  if (!status) return "当前没有待确认的日程提案。";
  if (status === "superseded") return "这份提案已被更新的提案替代，未执行任何操作。";
  if (status === "cancelled") return "这份提案已取消，未执行任何操作。";
  if (status === "applied") return "这份提案已经处理过，不会重复执行。";
  if (status === "expired") return "这份提案已过期，正在根据最新日程重新生成预览。";
  return "这份提案当前不能执行，未修改日程。";
}

async function handleProposalAction(ownerId: string, receiptId: string, action: NonNullable<ReturnType<typeof parseQqProposalAction>>) {
  if (action.action === "cancel") {
    const proposal = await cancelQqScheduleProposal(ownerId, action.publicId);
    if (!proposal || proposal.status !== "cancelled") return terminalProposalReply(proposal?.status);
    await updateReceipt(proposal.sourceReceiptId, "processed", "提案已取消。", { kind: "schedule_proposal", proposalId: proposal.id, publicId: proposal.publicId, state: "cancelled" });
    await updateReceipt(receiptId, "processed", "提案已取消。", { kind: "proposal_action", action: "cancel", proposalId: proposal.id });
    return "已取消该日程提案，没有创建任务或修改日程。";
  }

  const claimed = await claimQqScheduleProposal(ownerId, action.publicId);
  const proposal = claimed.proposal;
  if (!proposal) return terminalProposalReply();
  if (!claimed.claimed) {
    if (proposal.status === "expired") {
      const refreshed = await createProposal(ownerId, receiptId, proposal.intent);
      return `原提案已过期，未执行。\n\n${refreshed.reply}`;
    }
    return terminalProposalReply(proposal.status);
  }

  const store = getActiveScheduleStore();
  try {
    const currentPreview = await buildQqProposalPreview(store, proposal.intent);
    if (currentPreview.baseFingerprint !== proposal.preview.baseFingerprint) {
      const refreshed = await createQqScheduleProposal({ ownerId, sourceReceiptId: receiptId, intent: proposal.intent, preview: currentPreview });
      const reply = `日程已发生变化，旧提案未执行。\n\n${formatQqScheduleProposal(refreshed.proposal.publicId, currentPreview, true)}`;
      await updateReceipt(receiptId, "pending_confirmation", reply, { kind: "schedule_proposal", proposalId: refreshed.proposal.id, publicId: refreshed.proposal.publicId, state: "pending" });
      return reply;
    }

    if (action.action === "save_unplanned") {
      if (proposal.intent.kind !== "insert" || proposal.preview.decision !== "no_slot") {
        await releaseQqScheduleProposal(proposal.id, "save_unplanned is not valid for this proposal");
        return "这份提案不能保存到待安排，未修改日程。";
      }
      const result = await store.saveUnplannedTask(proposal.intent.task, { mode: proposal.intent.mode, source: "qq-confirmed-unplanned" });
      if (!result.changeSetId) throw new Error("QQ_SAVE_UNPLANNED_FAILED");
      await markQqScheduleProposalApplied(proposal.id, result.changeSetId);
      await updateReceipt(proposal.sourceReceiptId, "processed", "已保存到待安排。", { kind: "schedule_proposal", proposalId: proposal.id, publicId: proposal.publicId, state: "applied", changeSetId: result.changeSetId });
      await updateReceipt(receiptId, "processed", "已保存到待安排。", { kind: "proposal_action", action: "save_unplanned", proposalId: proposal.id, changeSetId: result.changeSetId });
      return `✅ 已保存到待安排\n\n${proposal.preview.taskTitle}\n${proposal.preview.date} · ${proposal.preview.durationMinutes} 分钟\n当前没有创建时间块。`;
    }

    if (proposal.preview.decision === "no_slot") {
      await releaseQqScheduleProposal(proposal.id, "confirmation requires save_unplanned or changed constraints");
      return `当前没有安全空档，不能直接确认安排。请回复“保存到待安排 ${proposal.publicId}”或“取消 ${proposal.publicId}”。`;
    }
    const result = proposal.intent.kind === "insert"
      ? await store.confirmTask(proposal.intent.task, { mode: proposal.intent.mode, source: proposal.intent.mode === "optimize" ? "qq-optimize-confirmed" : "qq-confirmed" })
      : await store.rescheduleTask(proposal.intent.taskId, proposal.intent.date, proposal.intent.startMinutes, { mode: proposal.intent.mode, confirm: true, source: proposal.intent.mode === "optimize" ? "qq-optimize-confirmed" : "qq-confirmed" });
    if (!result.changeSetId || result.proposal.decision !== "auto") throw new Error("QQ_PROPOSAL_APPLY_FAILED");
    await markQqScheduleProposalApplied(proposal.id, result.changeSetId);
    await updateReceipt(proposal.sourceReceiptId, "processed", "提案已确认并应用。", { kind: "schedule_proposal", proposalId: proposal.id, publicId: proposal.publicId, state: "applied", changeSetId: result.changeSetId });
    await updateReceipt(receiptId, "processed", "提案已确认并应用。", { kind: "proposal_action", action: "confirm", proposalId: proposal.id, changeSetId: result.changeSetId });
    const placement = result.proposal.placement;
    return `✅ 已确认并更新日程\n\n${proposal.preview.taskTitle}${placement ? `\n${placement.date} ${String(Math.floor(placement.startMinutes / 60)).padStart(2, "0")}:${String(placement.startMinutes % 60).padStart(2, "0")}–${String(Math.floor(placement.endMinutes / 60)).padStart(2, "0")}:${String(placement.endMinutes % 60).padStart(2, "0")}` : ""}`;
  } catch (error) {
    await releaseQqScheduleProposal(proposal.id, sanitizedQqError(error));
    throw error;
  }
}

async function handleProposalEdit(ownerId: string, receiptId: string, edit: NonNullable<ReturnType<typeof parseQqProposalEdit>>) {
  const proposal = await findQqScheduleProposal(ownerId, edit.publicId);
  if (!proposal || proposal.status !== "pending") return { reply: terminalProposalReply(proposal?.status) };
  const store = getActiveScheduleStore();
  if (edit.kind === "change_time" && edit.startMinutes === undefined) {
    const candidates = await findQqSafeTimeCandidates(store, proposal.intent);
    const lines = candidates.length > 0
      ? candidates.map((candidate, index) => `${index + 1}. ${candidate.date} ${String(Math.floor(candidate.startMinutes / 60)).padStart(2, "0")}:${String(candidate.startMinutes % 60).padStart(2, "0")}–${String(Math.floor(candidate.endMinutes / 60)).padStart(2, "0")}:${String(candidate.endMinutes % 60).padStart(2, "0")}`)
      : ["当前没有其他不移动任务的安全时间。"];
    const reply = `其他安全时间 · ${proposal.publicId}\n\n${lines.join("\n")}\n\n回复“改时间 ${proposal.publicId} YYYY-MM-DD HH:MM”生成新预览；原提案仍未执行。`;
    await finishReceivedReceipt(receiptId, reply, { kind: "proposal_edit", action: "change_time_candidates", proposalId: proposal.id });
    return { reply };
  }
  if (edit.kind === "change_duration" && edit.durationMinutes === undefined) {
    const reply = `选择新时长 · ${proposal.publicId}\n\n15 / 30 / 45 / 60 / 90 / 120 分钟\n\n回复“改时长 ${proposal.publicId} 60”；选择后会生成新预览，不会直接执行。`;
    await finishReceivedReceipt(receiptId, reply, { kind: "proposal_edit", action: "change_duration_choices", proposalId: proposal.id });
    return { reply };
  }

  let intent: QqScheduleProposalIntent;
  if (edit.kind === "change_time") {
    const date = edit.date ?? (proposal.intent.kind === "insert" ? proposal.intent.task.date : proposal.intent.date);
    intent = proposal.intent.kind === "insert"
      ? { ...proposal.intent, task: { ...proposal.intent.task, date, preferredStartMinutes: edit.startMinutes, exactStartMinutes: edit.startMinutes } }
      : { ...proposal.intent, date, startMinutes: edit.startMinutes! };
  } else {
    if (proposal.intent.kind !== "insert") {
      const reply = "已排期任务的时长修改需要同时预览任务字段和时间块，本阶段未执行；请重新描述完整调整要求。";
      await finishReceivedReceipt(receiptId, reply, { kind: "proposal_edit", action: "change_duration_unsupported", proposalId: proposal.id });
      return { reply };
    }
    intent = { ...proposal.intent, task: { ...proposal.intent.task, estimatedMinutes: edit.durationMinutes! } };
  }
  const created = await createProposal(ownerId, receiptId, intent);
  return { reply: created.reply, proposal: created.proposal };
}

if (!reminderChannelIsEnabled("qq")) {
  console.error("[goalset-worker] QQ reminder channel is disabled by REMINDER_CHANNELS");
  process.exitCode = 1;
} else if (!qqIsConfigured()) {
  console.error(`[goalset-worker] ${qqConfigError()}`);
  process.exitCode = 1;
} else {
  const bot = new QQBot({
    appId: process.env.QQBOT_APP_ID!,
    appSecret: process.env.QQBOT_APP_SECRET!,
    accountId: "goalset-personal",
    tokenPrefetch: "sync",
    logger: {
      debug: () => undefined,
      info: (message) => console.info("[qq]", message),
      warn: (message) => console.warn("[qq]", message),
      error: (message) => console.error("[qq]", sanitizedQqError(message)),
    },
  });
  bot.on("ready", () => { console.info("[goalset-worker] QQ Bot ready"); void recordWorkerHealth("qq", "running"); });
  bot.on("error", (error) => { const message = sanitizedQqError(error); console.error("[goalset-worker] QQ Bot error", message); void recordWorkerHealth("qq", "error", message); });
  bot.on("interaction", async (_context, event) => {
    const senderId = event.user_openid ?? event.data.resolved.user_id;
    if (!senderId || senderId !== process.env.QQBOT_OWNER_USER_ID) {
      await bot.acknowledgeInteraction(event.id, 4).catch(() => undefined);
      return;
    }
    const action = parseQqProposalButtonData(event.data.resolved.button_data);
    if (!action) {
      await bot.acknowledgeInteraction(event.id, 1).catch(() => undefined);
      return;
    }
    await bot.acknowledgeInteraction(event.id, 0).catch((error) => console.warn("[goalset-worker] QQ interaction ACK failed", sanitizedQqError(error)));
    const receipt = await claimCommand(event.id, senderId, "qq-interaction");
    if (!receipt) return;
    try {
      const responseText = await handleProposalAction(senderId, receipt.id, action);
      await sendActionReply(bot, senderId, { scope: "c2c", targetId: senderId }, responseText);
      await finishReceivedReceipt(receipt.id, responseText, { kind: "proposal_interaction", action: action.action, publicId: action.publicId });
    } catch (error) {
      const responseText = "按钮处理失败，原日程没有改变。你仍可使用提案 ID 通过文字确认。";
      await updateReceipt(receipt.id, "failed", responseText, { kind: "proposal_interaction", action: action.action, publicId: action.publicId });
      await bot.sendText({ scope: "c2c", targetId: senderId }, responseText).catch(() => undefined);
      console.error("[goalset-worker] QQ interaction failed", sanitizedQqError(error));
    }
  });
  bot.on("message", async (_context, message) => {
    if (message.kind !== "c2c" || message.senderId !== process.env.QQBOT_OWNER_USER_ID) return;
    const receipt = await claimCommand(String(message.messageId), String(message.senderId));
    if (!receipt) return;
    const date = todayInShanghai();
    const store = getActiveScheduleStore();
    const text = message.content.trim();
    const controlCommand = parseQqControlCommand(text);
    const proposalAction = parseQqProposalAction(text);
    const proposalEdit = parseQqProposalEdit(text);
    const { optimize, commandText } = parseQqCommandMode(text);

    try {
      if (controlCommand) {
        await bot.sendText(message.replyTarget, controlCommand.reply);
        await updateReceipt(receipt.id, "processed", controlCommand.reply, { kind: controlCommand.kind });
        return;
      }
      if (proposalAction) {
        const responseText = await handleProposalAction(String(message.senderId), receipt.id, proposalAction);
        await sendActionReply(bot, String(message.senderId), message.replyTarget, responseText);
        await finishReceivedReceipt(receipt.id, responseText, { kind: "proposal_action", action: proposalAction.action });
        return;
      }
      if (proposalEdit) {
        const result = await handleProposalEdit(String(message.senderId), receipt.id, proposalEdit);
        if (result.proposal) await sendProposalReply(bot, message.replyTarget, result.reply, result.proposal.publicId, result.proposal.preview.decision);
        else await bot.sendText(message.replyTarget, result.reply);
        await finishReceivedReceipt(receipt.id, result.reply, { kind: "proposal_edit", action: proposalEdit.kind, publicId: proposalEdit.publicId });
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
        const task = snapshot.tasks.find((item) => item.id === plan.targetTaskId);
        const block = snapshot.blocks.find((item) => item.taskId === plan.targetTaskId);
        if (!task || !block) {
          const responseText = "没有找到可改期的已排期任务，原日程未改变。";
          await bot.sendText(message.replyTarget, responseText);
          await updateReceipt(receipt.id, "processed", responseText);
          return;
        }
        const intent: QqScheduleProposalIntent = { kind: "reschedule", taskId: plan.targetTaskId, taskTitle: task.title, durationMinutes: task.estimatedMinutes, originDate: task.date, date: targetDate, startMinutes: plan.targetStartMinutes, mode: optimize ? "optimize" : "rules", originalCommand: message.content };
        const created = await createProposal(String(message.senderId), receipt.id, intent);
        await sendProposalReply(bot, message.replyTarget, created.reply, created.proposal.publicId, created.proposal.preview.decision);
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
      const intent: QqScheduleProposalIntent = { kind: "insert", task, mode: optimize ? "optimize" : "rules", originalCommand: message.content };
      const created = await createProposal(String(message.senderId), receipt.id, intent);
      await sendProposalReply(bot, message.replyTarget, created.reply, created.proposal.publicId, created.proposal.preview.decision);
    } catch (error) {
      console.error("[goalset-worker] command failed", sanitizedQqError(error));
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
    console.error("[goalset-worker] stopped with error", sanitizedQqError(error));
    process.exitCode = 1;
  });
}
