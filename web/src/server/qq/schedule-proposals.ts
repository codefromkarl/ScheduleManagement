import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { ScheduleStore } from "@/features/schedule/data/store-types";
import type { ScheduleSnapshot } from "@/features/schedule/data/types";
import type { InlineKeyboard } from "@tencent-connect/qqbot-nodejs";
import { getDb, type GoalsetDb } from "@/server/db";
import { commandReceipts, qqScheduleProposals } from "@/server/db/schema";
import { REMINDER_WORKSPACE_ID } from "@/server/reminders";
import type { QqScheduleProposalIntent, QqScheduleProposalPreview } from "./schedule-proposal-types";

export const QQ_PROPOSAL_TTL_MS = 15 * 60_000;
const ACTIVE_SLOT = "active";

function normalizedSnapshot(snapshot: ScheduleSnapshot) {
  return {
    date: snapshot.date,
    bufferMinutes: snapshot.bufferMinutes,
    tasks: [...snapshot.tasks].sort((left, right) => left.id.localeCompare(right.id)),
    blocks: [...snapshot.blocks].sort((left, right) => left.id.localeCompare(right.id)),
    availability: [...snapshot.availability].sort((left, right) => left.startMinutes - right.startMinutes),
    unavailable: [...snapshot.unavailable].sort((left, right) => left.startMinutes - right.startMinutes),
  };
}

export function scheduleSnapshotFingerprint(snapshots: ScheduleSnapshot[]) {
  const normalized = [...snapshots].sort((left, right) => left.date.localeCompare(right.date)).map(normalizedSnapshot);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function proposalPublicId(id: string) {
  return `P-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export async function buildQqProposalPreview(store: ScheduleStore, intent: QqScheduleProposalIntent): Promise<QqScheduleProposalPreview> {
  if (intent.kind === "insert") {
    const result = await store.previewTask(intent.task, { mode: intent.mode, source: intent.mode === "optimize" ? "qq-optimize-preview" : "qq-preview" });
    const moveTitles = new Map(result.snapshot.blocks.map((block) => [block.id, block.title]));
    return {
      decision: result.proposal.decision,
      taskTitle: intent.task.title,
      date: intent.task.date,
      durationMinutes: intent.task.estimatedMinutes,
      placement: result.proposal.placement,
      moves: result.proposal.moves.map((move) => ({ ...move, title: moveTitles.get(move.blockId) ?? "未命名任务" })),
      contextBlocks: result.snapshot.blocks.map((block) => ({ id: block.id, title: block.title, startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: block.kind })),
      crossDate: false,
      occupiedNoSlot: result.proposal.decision === "no_slot" && result.snapshot.blocks.length > 0,
      reasons: result.proposal.reasons,
      baseFingerprint: scheduleSnapshotFingerprint([result.snapshot]),
    };
  }

  const result = await store.previewRescheduleTask(intent.taskId, intent.date, intent.startMinutes, { mode: intent.mode, source: intent.mode === "optimize" ? "qq-optimize-preview" : "qq-preview" });
  const dates = [...new Set([intent.originDate, intent.date])];
  const snapshots = await store.getSnapshots(dates);
  const moveTitles = new Map(snapshots.flatMap((snapshot) => snapshot.blocks.map((block) => [block.id, block.title] as const)));
  return {
    decision: result.proposal.decision,
    taskTitle: intent.taskTitle,
    date: intent.date,
    durationMinutes: intent.durationMinutes,
    placement: result.proposal.placement,
    moves: result.proposal.moves.map((move) => ({ ...move, title: moveTitles.get(move.blockId) ?? "未命名任务" })),
    contextBlocks: result.snapshot.blocks.map((block) => ({ id: block.id, title: block.title, startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: block.kind })),
    crossDate: intent.originDate !== intent.date,
    occupiedNoSlot: result.proposal.decision === "no_slot" && result.snapshot.blocks.length > 0,
    reasons: result.proposal.reasons,
    baseFingerprint: scheduleSnapshotFingerprint(snapshots),
  };
}

export async function createQqScheduleProposal(input: {
  ownerId: string;
  sourceReceiptId: string;
  intent: QqScheduleProposalIntent;
  preview: QqScheduleProposalPreview;
  now?: Date;
  db?: GoalsetDb;
}) {
  const db = input.db ?? getDb();
  const now = input.now ?? new Date();
  const id = randomUUID();
  const publicId = proposalPublicId(id);
  const expiresAt = new Date(now.getTime() + QQ_PROPOSAL_TTL_MS);
  let superseded = 0;
  await db.transaction(async (tx) => {
    const previous = await tx.update(qqScheduleProposals).set({ status: "superseded", activeSlot: null, updatedAt: now }).where(and(eq(qqScheduleProposals.workspaceId, REMINDER_WORKSPACE_ID), eq(qqScheduleProposals.ownerId, input.ownerId), eq(qqScheduleProposals.activeSlot, ACTIVE_SLOT), inArray(qqScheduleProposals.status, ["pending", "applying"]))).returning({ id: qqScheduleProposals.id, sourceReceiptId: qqScheduleProposals.sourceReceiptId });
    superseded = previous.length;
    if (previous.length > 0) await tx.update(commandReceipts).set({ status: "processed", responseText: "提案已被更新的日程提案替代。", updatedAt: now }).where(inArray(commandReceipts.id, previous.map((item) => item.sourceReceiptId)));
    await tx.insert(qqScheduleProposals).values({ id, publicId, workspaceId: REMINDER_WORKSPACE_ID, ownerId: input.ownerId, sourceReceiptId: input.sourceReceiptId, status: "pending", activeSlot: ACTIVE_SLOT, version: 1, intent: input.intent, preview: input.preview, expiresAt });
    await tx.update(commandReceipts).set({ status: "pending_confirmation", payload: { kind: "schedule_proposal", proposalId: id, publicId }, updatedAt: now }).where(eq(commandReceipts.id, input.sourceReceiptId));
  });
  const [proposal] = await db.select().from(qqScheduleProposals).where(eq(qqScheduleProposals.id, id));
  return { proposal, superseded };
}

export async function findQqScheduleProposal(ownerId: string, publicId?: string, now = new Date(), db: GoalsetDb = getDb()) {
  const condition = publicId
    ? and(eq(qqScheduleProposals.workspaceId, REMINDER_WORKSPACE_ID), eq(qqScheduleProposals.ownerId, ownerId), eq(qqScheduleProposals.publicId, publicId.toUpperCase()))
    : and(eq(qqScheduleProposals.workspaceId, REMINDER_WORKSPACE_ID), eq(qqScheduleProposals.ownerId, ownerId), eq(qqScheduleProposals.activeSlot, ACTIVE_SLOT));
  const [proposal] = await db.select().from(qqScheduleProposals).where(condition).orderBy(desc(qqScheduleProposals.createdAt)).limit(1);
  if (!proposal) return undefined;
  if (proposal.status === "pending" && proposal.expiresAt <= now) {
    let expired: typeof proposal | undefined;
    await db.transaction(async (tx) => {
      [expired] = await tx.update(qqScheduleProposals).set({ status: "expired", activeSlot: null, updatedAt: now }).where(and(eq(qqScheduleProposals.id, proposal.id), eq(qqScheduleProposals.status, "pending"))).returning();
      if (expired) await tx.update(commandReceipts).set({ status: "processed", responseText: "日程提案已过期。", updatedAt: now }).where(eq(commandReceipts.id, proposal.sourceReceiptId));
    });
    return expired ?? { ...proposal, status: "expired" as const, activeSlot: null };
  }
  return proposal;
}

export async function claimQqScheduleProposal(ownerId: string, publicId?: string, now = new Date(), db: GoalsetDb = getDb()) {
  const proposal = await findQqScheduleProposal(ownerId, publicId, now, db);
  if (!proposal || proposal.status !== "pending") return { proposal, claimed: false as const };
  const [claimed] = await db.update(qqScheduleProposals).set({ status: "applying", updatedAt: now }).where(and(eq(qqScheduleProposals.id, proposal.id), eq(qqScheduleProposals.status, "pending"), eq(qqScheduleProposals.activeSlot, ACTIVE_SLOT), gt(qqScheduleProposals.expiresAt, now))).returning();
  return { proposal: claimed ?? proposal, claimed: Boolean(claimed) };
}

export async function cancelQqScheduleProposal(ownerId: string, publicId?: string, now = new Date(), db: GoalsetDb = getDb()) {
  const proposal = await findQqScheduleProposal(ownerId, publicId, now, db);
  if (!proposal || proposal.status !== "pending") return proposal;
  const [cancelled] = await db.update(qqScheduleProposals).set({ status: "cancelled", activeSlot: null, updatedAt: now }).where(and(eq(qqScheduleProposals.id, proposal.id), eq(qqScheduleProposals.status, "pending"))).returning();
  return cancelled ?? proposal;
}

export async function markQqScheduleProposalApplied(id: string, changeSetId: string, now = new Date(), db: GoalsetDb = getDb()) {
  const [applied] = await db.update(qqScheduleProposals).set({ status: "applied", activeSlot: null, appliedChangeSetId: changeSetId, lastError: null, updatedAt: now }).where(and(eq(qqScheduleProposals.id, id), eq(qqScheduleProposals.status, "applying"))).returning();
  return applied;
}

export async function releaseQqScheduleProposal(id: string, error: string, now = new Date(), db: GoalsetDb = getDb()) {
  const [released] = await db.update(qqScheduleProposals).set({ status: "pending", lastError: error.slice(0, 500), updatedAt: now }).where(and(eq(qqScheduleProposals.id, id), eq(qqScheduleProposals.status, "applying"))).returning();
  return released;
}

export type QqProposalAction = "confirm" | "save_unplanned" | "cancel";

export function parseQqProposalAction(message: string): { action: QqProposalAction; publicId?: string } | null {
  const text = message.trim().replace(/\s+/g, " ");
  const match = text.match(/^(确认|保存到待安排|取消)(?:\s+(P-[A-F0-9]{8}))?$/i);
  if (!match) return null;
  const action = match[1] === "确认" ? "confirm" : match[1] === "保存到待安排" ? "save_unplanned" : "cancel";
  return { action, publicId: match[2]?.toUpperCase() };
}

export function qqProposalButtonData(action: QqProposalAction, publicId: string) {
  return `goalset-proposal:${action}:${publicId.toUpperCase()}`;
}

export function parseQqProposalButtonData(data?: string) {
  const match = data?.match(/^goalset-proposal:(confirm|save_unplanned|cancel):(P-[A-F0-9]{8})$/i);
  if (!match) return null;
  return { action: match[1].toLowerCase() as QqProposalAction, publicId: match[2].toUpperCase() };
}

function proposalButton(id: string, label: string, action: QqProposalAction, publicId: string, style: number) {
  return { id, render_data: { label, visited_label: label, style }, action: { type: 2, permission: { type: 2 }, data: qqProposalButtonData(action, publicId), click_limit: 1 } };
}

export function qqProposalKeyboard(publicId: string, decision: QqScheduleProposalPreview["decision"]): InlineKeyboard {
  const primary = decision === "no_slot"
    ? proposalButton("goalset-save-unplanned", "保存到待安排", "save_unplanned", publicId, 1)
    : proposalButton("goalset-confirm", "确认安排", "confirm", publicId, 1);
  return { content: { rows: [{ buttons: [primary, proposalButton("goalset-cancel", "取消", "cancel", publicId, 0)] }] } };
}

function formatMinutes(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatQqScheduleProposal(publicId: string, preview: QqScheduleProposalPreview, superseded = false) {
  const lines = [
    superseded ? "上一份待确认提案已取消。" : "",
    `🗓️ 日程安排预览 · ${publicId}`,
    "",
    `任务：${preview.taskTitle}`,
    `日期：${preview.date}`,
    `时长：${preview.durationMinutes} 分钟`,
  ].filter(Boolean);
  if (preview.placement) lines.push(`拟安排：${formatMinutes(preview.placement.startMinutes)}–${formatMinutes(preview.placement.endMinutes)}`);
  if (preview.moves.length > 0) {
    lines.push("影响：");
    for (const move of preview.moves) lines.push(`- ${move.title}：${formatMinutes(move.fromStartMinutes)} → ${formatMinutes(move.toStartMinutes)}`);
  } else {
    lines.push(preview.decision === "no_slot" ? "结果：当前没有安全空档" : "影响：不移动现有安排");
  }
  if (preview.reasons.length > 0) lines.push(`原因：${preview.reasons.join(" ")}`);
  lines.push("", "确认前尚未创建任务或修改日程。提案 15 分钟内有效。");
  if (preview.decision === "no_slot") lines.push(`回复“保存到待安排 ${publicId}”或“取消 ${publicId}”。`);
  else lines.push(`回复“确认 ${publicId}”或“取消 ${publicId}”。`);
  return lines.join("\n");
}
