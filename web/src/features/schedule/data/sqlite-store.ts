import { and, eq, inArray, isNull, like, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db";
import { findScheduleProposal, placementToBlock } from "../domain/scheduler";
import type { ScheduleTask, ScheduledBlock } from "../domain/types";
import { evaluateTaskReminder } from "../domain/reminder-policy";
import { rankUnplannedTasks } from "../domain/unplanned";
import { createDemoSnapshot } from "./demo-snapshot";
import type { ArrangeUnplannedResult, DailyCloseAction, DailyCloseResult, RescheduleTaskOptions, RescheduleTaskResult, ScheduleExistingTaskOptions, ScheduleExistingTaskResult, ScheduleMutationOptions, ScheduleStore, TaskUpdateAudit } from "./store-types";
import type { ScheduleSnapshot } from "./types";
import { applyOccurrenceOverrides, generateOccurrenceDates } from "../domain/recurrence";
import { availabilityRules, changeSets, occurrenceOverrides, preferences, projects, recurrenceRules, reminders, scheduleBlocks, tasks, unavailableWindows, workspaces } from "@/server/db/schema";
import { configuredReminderChannels, REMINDER_WORKSPACE_ID } from "@/server/reminders";

const WORKSPACE_ID = REMINDER_WORKSPACE_ID;
type ScheduleTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function reminderTime(date: string, startMinutes: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, Math.floor(startMinutes / 60) - 8, startMinutes % 60));
}

async function reminderTask(tx: ScheduleTransaction, taskId: string) {
  const [task] = await tx.select().from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId))).limit(1);
  return task;
}

async function enqueueStartReminder(tx: ScheduleTransaction, block: ScheduledBlock, knownTask?: ScheduleTask) {
  const task = knownTask ?? await reminderTask(tx, block.taskId);
  if (!task) return;
  const decision = evaluateTaskReminder(task, "start");
  if (!decision.eligible) return;
  const scheduledAt = reminderTime(block.date, Math.max(0, block.startMinutes - 15));
  const channels = configuredReminderChannels();
  if (channels.length === 0) return;
  await tx.insert(reminders).values(channels.map((channel) => ({
    id: `start:${block.id}:${channel}`,
    workspaceId: WORKSPACE_ID,
    taskId: block.taskId,
    blockId: block.id,
    kind: "start" as const,
    channel,
    scheduledAt,
    status: "pending" as const,
    dedupeKey: `start:${block.id}:${channel}`,
    importanceReasons: decision.reasons,
  }))).onConflictDoNothing();
}

async function enqueueScheduleChangeReminder(tx: ScheduleTransaction, changeSetId: string, taskIds: string[]) {
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) return;
  const taskRows = await tx.select().from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), inArray(tasks.id, uniqueTaskIds)));
  const important = taskRows.map((task) => ({ task, decision: evaluateTaskReminder(task, "schedule_change") })).find((item) => item.decision.eligible);
  if (!important) return;
  const channels = configuredReminderChannels();
  if (channels.length === 0) return;
  await tx.insert(reminders).values(channels.map((channel) => ({
    id: `change:${changeSetId}:${channel}`,
    workspaceId: WORKSPACE_ID,
    taskId: important.task.id,
    kind: "schedule_change" as const,
    channel,
    scheduledAt: new Date(),
    status: "pending" as const,
    dedupeKey: `change:${changeSetId}:${channel}`,
    importanceReasons: important.decision.reasons,
  }))).onConflictDoNothing();
}

function weekdayFor(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function affectedTaskIds(primaryTaskId: string, movedBlockIds: Array<{ blockId: string }>, blocks: ScheduledBlock[]) {
  const taskIds = movedBlockIds.flatMap((move) => blocks.find((block) => block.id === move.blockId)?.taskId ?? []);
  return [primaryTaskId, ...taskIds];
}

function toTask(row: typeof tasks.$inferSelect): ScheduleTask {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    reminderPolicy: row.reminderPolicy,
    estimatedMinutes: row.estimatedMinutes,
    movable: row.movable,
    preferredStartMinutes: row.preferredStartMinutes ?? undefined,
    deadlineMinutes: row.deadlineMinutes ?? undefined,
    projectId: row.projectId ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function toBlock(row: typeof scheduleBlocks.$inferSelect, task?: typeof tasks.$inferSelect): ScheduledBlock {
  return {
    id: row.id,
    taskId: row.taskId,
    date: row.date,
    startMinutes: row.startMinutes,
    durationMinutes: row.durationMinutes,
    kind: row.kind,
    movable: row.movable,
    title: task?.title ?? row.taskId,
    priority: task?.priority,
    projectId: task?.projectId ?? undefined,
  };
}

async function ensureWorkspace() {
  const db = getDb();
  await db.insert(workspaces).values({ id: WORKSPACE_ID, name: "个人工作区", timezone: "Asia/Shanghai" }).onConflictDoNothing();
  await db.insert(availabilityRules).values(Array.from({ length: 7 }, (_, weekday) => ({ id: `availability:${weekday}`, workspaceId: WORKSPACE_ID, weekday, startMinutes: 540, endMinutes: 1080, enabled: true }))).onConflictDoNothing();
  return db;
}

export async function seedDate(date: string) {
  const db = await ensureWorkspace();
  const existing = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.date, date)));
  if (existing.length > 0) return;

  const snapshot = createDemoSnapshot(date);
  const seededTasks = snapshot.tasks.map((task) => ({ ...task, id: `${task.id}:${date}` }));
  const seededTaskIds = new Map(snapshot.tasks.map((task) => [task.id, `${task.id}:${date}`]));
  await db.insert(projects).values([
    { id: "Goalset 产品", workspaceId: WORKSPACE_ID, name: "Goalset 产品", tone: "#ed8b55" },
    { id: "工作推进", workspaceId: WORKSPACE_ID, name: "工作推进", tone: "#45aa91" },
  ]).onConflictDoNothing();
  await db.insert(tasks).values(seededTasks.map((task) => ({
    id: task.id,
    workspaceId: WORKSPACE_ID,
    projectId: task.projectId,
    title: task.title,
    date: task.date,
    kind: task.kind,
    status: task.status,
    priority: task.priority,
    reminderPolicy: task.reminderPolicy,
    estimatedMinutes: task.estimatedMinutes,
    movable: task.movable,
    preferredStartMinutes: task.preferredStartMinutes,
    deadlineMinutes: task.deadlineMinutes,
    source: "seed",
  }))).onConflictDoNothing();
  await db.insert(scheduleBlocks).values(snapshot.blocks.map((block) => ({
    id: `${block.id}:${date}`,
    workspaceId: WORKSPACE_ID,
    taskId: seededTaskIds.get(block.taskId) ?? `${block.taskId}:${date}`,
    date: block.date,
    startMinutes: block.startMinutes,
    durationMinutes: block.durationMinutes,
    kind: block.kind,
    movable: block.movable,
  }))).onConflictDoNothing();
  await db.insert(availabilityRules).values({
    id: `availability:${weekdayFor(date)}`,
    workspaceId: WORKSPACE_ID,
    weekday: weekdayFor(date),
    startMinutes: 540,
    endMinutes: 1080,
  }).onConflictDoNothing();
  await db.insert(unavailableWindows).values({
    id: `lunch:${date}`,
    workspaceId: WORKSPACE_ID,
    date,
    startMinutes: 720,
    endMinutes: 780,
    reason: "午休",
  }).onConflictDoNothing();
}

export class SqliteScheduleStore implements ScheduleStore {
  private async getRawSnapshot(date: string): Promise<ScheduleSnapshot> {
    const db = getDb();
    const [taskRows, blockRows, availabilityRows, unavailableRows, preferenceRows] = await Promise.all([
      db.select().from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.date, date))),
      db.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.date, date))),
      db.select().from(availabilityRules).where(and(eq(availabilityRules.workspaceId, WORKSPACE_ID), eq(availabilityRules.weekday, weekdayFor(date)), eq(availabilityRules.enabled, true))),
      db.select().from(unavailableWindows).where(and(eq(unavailableWindows.workspaceId, WORKSPACE_ID), eq(unavailableWindows.date, date))),
      db.select().from(preferences).where(eq(preferences.workspaceId, WORKSPACE_ID)),
    ]);
    const bufferPreference = preferenceRows.find((row) => row.key === "bufferMinutes")?.value;
    const defaultDurationPreference = preferenceRows.find((row) => row.key === "defaultDurationMinutes")?.value;
    return {
      date,
      tasks: taskRows.map(toTask),
      blocks: blockRows.map((row) => toBlock(row, taskRows.find((task) => task.id === row.taskId))),
      availability: availabilityRows.map((row) => ({ date, startMinutes: row.startMinutes, endMinutes: row.endMinutes })),
      unavailable: unavailableRows.map((row) => ({ date: row.date, startMinutes: row.startMinutes, endMinutes: row.endMinutes, reason: row.reason })),
      bufferMinutes: typeof bufferPreference === "number" && [0, 15, 30].includes(bufferPreference) ? bufferPreference : 15,
      defaultDurationMinutes: typeof defaultDurationPreference === "number" && [15, 30, 45, 60, 90, 120].includes(defaultDurationPreference) ? defaultDurationPreference : undefined,
    };
  }

  private async materializeRecurrences(date: string) {
    const db = getDb();
    const rules = await db.select({ rule: recurrenceRules, template: tasks }).from(recurrenceRules).innerJoin(tasks, eq(tasks.id, recurrenceRules.taskId)).where(eq(tasks.workspaceId, WORKSPACE_ID));
    for (const { rule, template } of rules) {
      const dates = generateOccurrenceDates({ frequency: rule.frequency, weekdays: rule.weekdays ?? undefined, startDate: rule.startDate, endDate: rule.endDate ?? undefined }, date, date);
      if (!dates.includes(date)) continue;
      const overrides = await db.select().from(occurrenceOverrides).where(eq(occurrenceOverrides.recurrenceId, rule.id));
      const occurrence = applyOccurrenceOverrides(dates, overrides.map((item) => ({ occurrenceDate: item.occurrenceDate, action: item.action, startMinutes: item.startMinutes, durationMinutes: item.durationMinutes, note: item.note }))).find((item) => item.date === date);
      const isTemplateOccurrence = template.date === date;
      const occurrenceTaskId = `${template.id}@${date}`;

      if (!occurrence) {
        if (isTemplateOccurrence) {
          await db.transaction(async (tx) => {
            await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, template.id)));
            await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.taskId, template.id), eq(scheduleBlocks.date, date)));
          });
        } else {
          await db.transaction(async (tx) => {
            await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, occurrenceTaskId)));
            await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.taskId, occurrenceTaskId)));
            await tx.delete(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, occurrenceTaskId)));
          });
        }
        continue;
      }

      if (isTemplateOccurrence && !occurrence.override) continue;
      const override = occurrence.override;
      const occurrenceTask: ScheduleTask = {
        ...toTask(template),
        id: isTemplateOccurrence ? template.id : occurrenceTaskId,
        date,
        estimatedMinutes: override?.durationMinutes ?? template.estimatedMinutes,
        preferredStartMinutes: override?.startMinutes ?? template.preferredStartMinutes ?? undefined,
      };
      const current = await this.getRawSnapshot(date);
      const currentBlock = current.blocks.find((block) => block.taskId === occurrenceTask.id && block.date === date);
      if (!isTemplateOccurrence && currentBlock && !override) continue;
      const contextBlocks = current.blocks.filter((block) => block.id !== currentBlock?.id && block.taskId !== occurrenceTask.id);
      const proposal = findScheduleProposal(occurrenceTask, { date, availability: current.availability, unavailable: current.unavailable, existing: contextBlocks, bufferMinutes: current.bufferMinutes });
      if (proposal.decision !== "auto" || !proposal.placement) {
        if (!isTemplateOccurrence && !current.tasks.some((task) => task.id === occurrenceTaskId)) {
          await db.insert(tasks).values({ id: occurrenceTaskId, workspaceId: WORKSPACE_ID, projectId: occurrenceTask.projectId, title: occurrenceTask.title, date, kind: occurrenceTask.kind, status: occurrenceTask.status, priority: occurrenceTask.priority, reminderPolicy: occurrenceTask.reminderPolicy, estimatedMinutes: occurrenceTask.estimatedMinutes, movable: occurrenceTask.movable, preferredStartMinutes: occurrenceTask.preferredStartMinutes, deadlineMinutes: occurrenceTask.deadlineMinutes, notes: occurrenceTask.notes, source: "recurrence" }).onConflictDoNothing();
        }
        continue;
      }
      const block = placementToBlock(occurrenceTask, proposal.placement);
      await db.transaction(async (tx) => {
        if (!isTemplateOccurrence && !currentBlock) {
          await tx.insert(tasks).values({ id: occurrenceTaskId, workspaceId: WORKSPACE_ID, projectId: occurrenceTask.projectId, title: occurrenceTask.title, date, kind: occurrenceTask.kind, status: occurrenceTask.status, priority: occurrenceTask.priority, reminderPolicy: occurrenceTask.reminderPolicy, estimatedMinutes: occurrenceTask.estimatedMinutes, movable: occurrenceTask.movable, preferredStartMinutes: occurrenceTask.preferredStartMinutes, deadlineMinutes: occurrenceTask.deadlineMinutes, notes: occurrenceTask.notes, source: "recurrence" }).onConflictDoNothing();
          await tx.insert(scheduleBlocks).values({ id: block.id, workspaceId: WORKSPACE_ID, taskId: block.taskId, date, startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: block.kind, movable: block.movable }).onConflictDoNothing();
          await enqueueStartReminder(tx, block, occurrenceTask);
        } else if (!isTemplateOccurrence && currentBlock) {
          await tx.update(scheduleBlocks).set({ startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, updatedAt: new Date() }).where(and(eq(scheduleBlocks.id, currentBlock.id), eq(scheduleBlocks.workspaceId, WORKSPACE_ID)));
          await tx.update(tasks).set({ estimatedMinutes: occurrenceTask.estimatedMinutes, preferredStartMinutes: occurrenceTask.preferredStartMinutes, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, occurrenceTaskId)));
        } else if (currentBlock) {
          await tx.update(scheduleBlocks).set({ startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, updatedAt: new Date() }).where(and(eq(scheduleBlocks.id, currentBlock.id), eq(scheduleBlocks.workspaceId, WORKSPACE_ID)));
          if (!isTemplateOccurrence) await tx.update(tasks).set({ estimatedMinutes: occurrenceTask.estimatedMinutes, preferredStartMinutes: occurrenceTask.preferredStartMinutes, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, occurrenceTaskId)));
        }
      });
    }
  }

  async getSnapshot(date: string): Promise<ScheduleSnapshot> {
    await ensureWorkspace();
    await this.materializeRecurrences(date);
    return this.getRawSnapshot(date);
  }

  async getUnplannedTasks() {
    const db = getDb();
    const rows = await db.select({ task: tasks }).from(tasks).leftJoin(scheduleBlocks, and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.taskId, tasks.id))).where(and(eq(tasks.workspaceId, WORKSPACE_ID), ne(tasks.status, "done"), isNull(scheduleBlocks.id)));
    return rankUnplannedTasks(rows.map((row) => toTask(row.task)));
  }

  async insertTask(task: ScheduleTask, options: ScheduleMutationOptions = {}) {
    const current = await this.getSnapshot(task.date);
    const proposal = findScheduleProposal(task, {
      date: current.date,
      availability: current.availability,
      unavailable: current.unavailable,
      existing: current.blocks,
      bufferMinutes: current.bufferMinutes,
      mode: options.mode ?? "rules",
    });
    if (proposal.decision !== "auto" || !proposal.placement) {
      if (proposal.decision !== "no_slot") return { proposal, snapshot: current };
      const changeSetId = randomUUID();
      const db = getDb();
      await db.transaction(async (tx) => {
        await tx.insert(tasks).values({
          id: task.id,
          workspaceId: WORKSPACE_ID,
          projectId: task.projectId,
          title: task.title,
          date: task.date,
          kind: task.kind,
          status: task.status,
          priority: task.priority,
          reminderPolicy: task.reminderPolicy,
          estimatedMinutes: task.estimatedMinutes,
          movable: task.movable,
          preferredStartMinutes: task.preferredStartMinutes,
          deadlineMinutes: task.deadlineMinutes,
          notes: task.notes,
          source: options.source ?? "web",
        });
        await tx.insert(changeSets).values({ id: changeSetId, workspaceId: WORKSPACE_ID, source: options.source ?? "web", originalCommand: task.title, parsedIntent: task, beforeState: { operation: "insert_unplanned", date: task.date, taskId: null, moves: [] }, afterState: { operation: "insert_unplanned", date: task.date, taskId: task.id, moves: [] }, status: "applied" });
      });
      return { proposal, snapshot: await this.getSnapshot(task.date), changeSetId };
    }
    const placement = proposal.placement;
    const changeSetId = randomUUID();

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.insert(tasks).values({
        id: task.id,
        workspaceId: WORKSPACE_ID,
        projectId: task.projectId,
        title: task.title,
        date: task.date,
        kind: task.kind,
        status: task.status,
        priority: task.priority,
        reminderPolicy: task.reminderPolicy,
        estimatedMinutes: task.estimatedMinutes,
        movable: task.movable,
        preferredStartMinutes: task.preferredStartMinutes,
        deadlineMinutes: task.deadlineMinutes,
        notes: task.notes,
        source: options.source ?? "web",
      });
      const block = placementToBlock(task, placement);
      await tx.insert(scheduleBlocks).values({
        id: block.id,
        workspaceId: WORKSPACE_ID,
        taskId: block.taskId,
        date: block.date,
        startMinutes: block.startMinutes,
        durationMinutes: block.durationMinutes,
        kind: block.kind,
        movable: block.movable,
      });
      await enqueueStartReminder(tx, block, task);
      await enqueueScheduleChangeReminder(tx, changeSetId, affectedTaskIds(task.id, proposal.moves, current.blocks));
      await tx.insert(changeSets).values({ id: changeSetId, workspaceId: WORKSPACE_ID, source: options.source ?? "web", originalCommand: task.title, parsedIntent: task, beforeState: { date: task.date, taskId: null, moves: [] }, afterState: { date: task.date, taskId: task.id, moves: [] }, status: "applied" });
    });
    return { proposal, snapshot: await this.getSnapshot(task.date), changeSetId };
  }

  async confirmTask(task: ScheduleTask, options: ScheduleMutationOptions = {}) {
    const current = await this.getSnapshot(task.date);
    const proposal = findScheduleProposal(task, {
      date: current.date,
      availability: current.availability,
      unavailable: current.unavailable,
      existing: current.blocks,
      bufferMinutes: current.bufferMinutes,
      mode: options.mode ?? "optimize",
    });
    if ((proposal.decision !== "needs_confirmation" && proposal.decision !== "auto") || !proposal.placement) return { proposal, snapshot: current };
    const placement = proposal.placement;
    const changeSetId = randomUUID();
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const move of proposal.moves) {
        await tx.update(scheduleBlocks).set({ startMinutes: move.toStartMinutes, updatedAt: new Date() }).where(eq(scheduleBlocks.id, move.blockId));
      }
      await tx.insert(tasks).values({
        id: task.id,
        workspaceId: WORKSPACE_ID,
        projectId: task.projectId,
        title: task.title,
        date: task.date,
        kind: task.kind,
        status: task.status,
        priority: task.priority,
        reminderPolicy: task.reminderPolicy,
        estimatedMinutes: task.estimatedMinutes,
        movable: task.movable,
        preferredStartMinutes: task.preferredStartMinutes,
        deadlineMinutes: task.deadlineMinutes,
        notes: task.notes,
        source: options.source ?? "web-confirmed",
      });
      const block = placementToBlock(task, placement);
      await tx.insert(scheduleBlocks).values({ id: block.id, workspaceId: WORKSPACE_ID, taskId: block.taskId, date: block.date, startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: block.kind, movable: block.movable });
      await enqueueStartReminder(tx, block, task);
      await enqueueScheduleChangeReminder(tx, changeSetId, affectedTaskIds(task.id, proposal.moves, current.blocks));
      await tx.insert(changeSets).values({ id: changeSetId, workspaceId: WORKSPACE_ID, source: options.source ?? "web-confirmed", originalCommand: task.title, parsedIntent: task, beforeState: { date: task.date, taskId: null, moves: proposal.moves.map((move) => ({ blockId: move.blockId, fromStartMinutes: move.fromStartMinutes })) }, afterState: { date: task.date, taskId: task.id, moves: proposal.moves }, status: "applied" });
    });
    return { proposal: { ...proposal, decision: "auto" as const }, snapshot: await this.getSnapshot(task.date), changeSetId };
  }

  async scheduleTask(taskId: string, date: string, options: ScheduleExistingTaskOptions): Promise<ScheduleExistingTaskResult> {
    const db = getDb();
    const [taskRow] = await db.select().from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId)));
    if (!taskRow) throw new Error("TASK_NOT_FOUND");
    const [existingBlock] = await db.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.taskId, taskId))).limit(1);
    const current = await this.getSnapshot(date);
    if (existingBlock) {
      return { taskId, date, proposal: { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务已经排入日程，请使用改期操作。"] }, snapshot: current };
    }

    const task = { ...toTask(taskRow), date };
    const targetEnd = options.startMinutes === undefined ? undefined : options.startMinutes + task.estimatedMinutes;
    const probe = {
      ...task,
      exactStartMinutes: options.startMinutes,
      deadlineMinutes: targetEnd === undefined ? task.deadlineMinutes : task.deadlineMinutes === undefined ? targetEnd : Math.min(task.deadlineMinutes, targetEnd),
    };
    const proposal = findScheduleProposal(probe, {
      date,
      availability: current.availability,
      unavailable: current.unavailable,
      existing: current.blocks,
      bufferMinutes: current.bufferMinutes,
      mode: options.mode ?? "rules",
    });
    if (proposal.decision === "needs_confirmation" && !options.confirm) return { taskId, date, proposal, snapshot: current };
    if ((proposal.decision !== "auto" && !(options.confirm && proposal.decision === "needs_confirmation")) || !proposal.placement) return { taskId, date, proposal, snapshot: current };

    const placement = proposal.placement;
    const block = placementToBlock(probe, placement);
    const changeSetId = randomUUID();
    await db.transaction(async (tx) => {
      for (const move of proposal.moves) {
        await tx.update(scheduleBlocks).set({ startMinutes: move.toStartMinutes, updatedAt: new Date() }).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.id, move.blockId)));
      }
      await tx.update(tasks).set({ date, ...(options.startMinutes !== undefined ? { preferredStartMinutes: placement.startMinutes } : {}), updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId)));
      await tx.insert(scheduleBlocks).values({ id: block.id, workspaceId: WORKSPACE_ID, taskId, date, startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: block.kind, movable: block.movable });
      await enqueueStartReminder(tx, block, task);
      await enqueueScheduleChangeReminder(tx, changeSetId, affectedTaskIds(taskId, proposal.moves, current.blocks));
      await tx.insert(changeSets).values({
        id: changeSetId,
        workspaceId: WORKSPACE_ID,
        source: options.source ?? (options.mode === "optimize" ? "ai-optimize" : "web-place"),
        originalCommand: options.mode === "optimize" ? `优化未排期任务：${task.title}` : `布置未排期任务：${task.title}`,
        parsedIntent: { taskId, date, startMinutes: options.startMinutes ?? null, mode: options.mode ?? "rules" },
        beforeState: { operation: "place", taskId, fromDate: taskRow.date, toDate: date, preferredStartMinutes: taskRow.preferredStartMinutes, moves: proposal.moves.map((move) => ({ blockId: move.blockId, fromStartMinutes: move.fromStartMinutes })) },
        afterState: { operation: "place", taskId, fromDate: taskRow.date, toDate: date, blockId: block.id, toStartMinutes: placement.startMinutes, moves: proposal.moves },
        status: "applied",
      });
    });
    return { taskId, date, proposal: { ...proposal, decision: "auto" }, snapshot: await this.getSnapshot(date), changeSetId };
  }

  async arrangeUnplanned(date: string): Promise<ArrangeUnplannedResult> {
    const current = await this.getSnapshot(date);
    const scheduledIds = new Set(current.blocks.map((block) => block.taskId));
    const queue = rankUnplannedTasks(current.tasks.filter((task) => task.status !== "done" && !scheduledIds.has(task.id)));
    const workingBlocks = [...current.blocks];
    const plannedBlocks: ScheduledBlock[] = [];

    for (const task of queue) {
      const proposal = findScheduleProposal(task, { date, availability: current.availability, unavailable: current.unavailable, existing: workingBlocks, bufferMinutes: current.bufferMinutes, mode: "rules" });
      if (proposal.decision !== "auto" || !proposal.placement) continue;
      const block = placementToBlock(task, proposal.placement);
      plannedBlocks.push(block);
      workingBlocks.push(block);
    }

    const arrangedTaskIds = plannedBlocks.map((block) => block.taskId);
    const arrangedIds = new Set(arrangedTaskIds);
    const remainingTaskIds = queue.filter((task) => !arrangedIds.has(task.id)).map((task) => task.id);
    if (plannedBlocks.length === 0) return { date, arrangedTaskIds, remainingTaskIds, snapshot: current };

    const changeSetId = randomUUID();
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const block of plannedBlocks) {
        await tx.insert(scheduleBlocks).values({ id: block.id, workspaceId: WORKSPACE_ID, taskId: block.taskId, date: block.date, startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: block.kind, movable: block.movable });
        await enqueueStartReminder(tx, block, current.tasks.find((task) => task.id === block.taskId));
      }
      await enqueueScheduleChangeReminder(tx, changeSetId, arrangedTaskIds);
      await tx.insert(changeSets).values({
        id: changeSetId,
        workspaceId: WORKSPACE_ID,
        source: "rules-batch",
        originalCommand: `按规则安排全部：${arrangedTaskIds.length} 项`,
        parsedIntent: { operation: "arrange_batch", date },
        beforeState: { operation: "arrange_batch", date },
        afterState: { operation: "arrange_batch", date, taskIds: arrangedTaskIds, blockIds: plannedBlocks.map((block) => block.id) },
        status: "applied",
      });
    });
    return { date, arrangedTaskIds, remainingTaskIds, snapshot: await this.getSnapshot(date), changeSetId };
  }

  async closeDay(date: string, action: DailyCloseAction): Promise<DailyCloseResult> {
    const current = await this.getSnapshot(date);
    const affectedTasks = current.tasks.filter((task) => task.status !== "done" && task.kind !== "fixed");
    const affectedTaskIds = affectedTasks.map((task) => task.id);
    const affectedIdSet = new Set(affectedTaskIds);
    const affectedBlocks = current.blocks.filter((block) => affectedIdSet.has(block.taskId));
    const targetDate = action === "move_tomorrow" ? nextDate(date) : date;
    if (affectedTaskIds.length === 0) return { date, targetDate, action, affectedTaskIds, snapshot: current };

    const changeSetId = randomUUID();
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), inArray(reminders.taskId, affectedTaskIds)));
      if (affectedBlocks.length > 0) await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), inArray(scheduleBlocks.id, affectedBlocks.map((block) => block.id))));
      if (action === "move_tomorrow") await tx.update(tasks).set({ date: targetDate, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), inArray(tasks.id, affectedTaskIds)));
      await enqueueScheduleChangeReminder(tx, changeSetId, affectedTaskIds);
      await tx.insert(changeSets).values({
        id: changeSetId,
        workspaceId: WORKSPACE_ID,
        source: "daily-close",
        originalCommand: action === "move_tomorrow" ? `今日收尾：${affectedTaskIds.length} 项移到明天待安排` : `今日收尾：${affectedTaskIds.length} 项留在今日待安排`,
        parsedIntent: { operation: "daily_close", action, date, targetDate },
        beforeState: { operation: "daily_close", action, date, targetDate, taskIds: affectedTaskIds, blocks: affectedBlocks },
        afterState: { operation: "daily_close", action, date, targetDate, taskIds: affectedTaskIds },
        status: "applied",
      });
    });
    return { date, targetDate, action, affectedTaskIds, snapshot: await this.getSnapshot(targetDate), changeSetId };
  }

  async updateTask(taskId: string, changes: Partial<Pick<ScheduleTask, "title" | "status" | "priority" | "reminderPolicy" | "notes">>, audit: TaskUpdateAudit = {}) {
    const db = getDb();
    const [before] = await db.select().from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId)));
    if (!before) throw new Error("TASK_NOT_FOUND");
    const [block] = await db.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.taskId, taskId))).limit(1);
    const changeSetId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.update(tasks).set({ ...changes, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId)));
      if (block && (changes.priority !== undefined || changes.reminderPolicy !== undefined)) {
        await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, taskId), eq(reminders.kind, "start"), eq(reminders.status, "pending")));
        await enqueueStartReminder(tx, toBlock(block, { ...before, ...changes }), { ...toTask(before), ...changes });
      }
      await tx.insert(changeSets).values({ id: changeSetId, workspaceId: WORKSPACE_ID, source: audit.source ?? "web", originalCommand: audit.originalCommand ?? "manual task update", parsedIntent: changes, beforeState: { operation: "task_update", date: before.date, taskId, title: before.title, status: before.status, priority: before.priority, reminderPolicy: before.reminderPolicy, notes: before.notes }, afterState: { operation: "task_update", date: before.date, taskId, ...changes }, status: "applied" });
    });
    return this.getSnapshot(before.date);
  }

  async rescheduleTask(taskId: string, date: string, startMinutes: number, options: RescheduleTaskOptions = {}): Promise<RescheduleTaskResult> {
    const db = getDb();
    const [taskRow] = await db.select().from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId)));
    if (!taskRow) throw new Error("TASK_NOT_FOUND");
    const task = toTask(taskRow);
    const originDate = taskRow.date;
    const current = await this.getSnapshot(date);
    const originSnapshot = originDate === date ? current : await this.getSnapshot(originDate);
    const block = originSnapshot.blocks.find((item) => item.taskId === taskId && item.date === originDate);
    if (!block) return { taskId, date, startMinutes, proposal: { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务还没有已调整的日程块。"] }, snapshot: current };
    const targetEnd = startMinutes + task.estimatedMinutes;
    const probe = { ...task, exactStartMinutes: startMinutes, deadlineMinutes: task.deadlineMinutes === undefined ? targetEnd : Math.min(task.deadlineMinutes, targetEnd) };
    const targetTask = { ...probe, date };
    const proposal = findScheduleProposal(targetTask, { date, availability: current.availability, unavailable: current.unavailable, existing: originDate === date ? current.blocks.filter((item) => item.id !== block.id) : current.blocks, bufferMinutes: current.bufferMinutes, mode: options.mode ?? "rules" });
    if (proposal.decision === "needs_confirmation" && !options.confirm) return { taskId, date, startMinutes, proposal, snapshot: current };
    if ((proposal.decision !== "auto" && !(options.confirm && proposal.decision === "needs_confirmation")) || !proposal.placement) return { taskId, date, startMinutes, proposal, snapshot: current };
    const changeSetId = randomUUID();
    const dbBlock = { ...block, title: task.title };
    const targetBlock = placementToBlock(targetTask, proposal.placement);
    await db.transaction(async (tx) => {
      for (const move of proposal.moves) await tx.update(scheduleBlocks).set({ startMinutes: move.toStartMinutes, updatedAt: new Date() }).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.id, move.blockId)));
      await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, taskId)));
      if (originDate === date) {
        await tx.update(scheduleBlocks).set({ startMinutes: proposal.placement!.startMinutes, durationMinutes: targetBlock.durationMinutes, updatedAt: new Date() }).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.id, block.id)));
      } else {
        await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.id, block.id)));
        await tx.update(tasks).set({ date, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId)));
        await tx.insert(scheduleBlocks).values({ id: targetBlock.id, workspaceId: WORKSPACE_ID, taskId, date, startMinutes: targetBlock.startMinutes, durationMinutes: targetBlock.durationMinutes, kind: targetBlock.kind, movable: targetBlock.movable });
      }
      await enqueueStartReminder(tx, originDate === date ? { ...dbBlock, startMinutes: proposal.placement!.startMinutes } : targetBlock, task);
      await enqueueScheduleChangeReminder(tx, changeSetId, affectedTaskIds(taskId, proposal.moves, current.blocks));
      await tx.insert(changeSets).values({ id: changeSetId, workspaceId: WORKSPACE_ID, source: options.source ?? "web-reschedule", originalCommand: task.title, parsedIntent: { taskId, date, startMinutes, mode: options.mode ?? "rules" }, beforeState: { operation: "reschedule", taskId, fromDate: originDate, toDate: date, blockId: block.id, fromStartMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: block.kind, movable: block.movable, title: block.title, moves: proposal.moves.map((move) => ({ blockId: move.blockId, fromStartMinutes: move.fromStartMinutes })) }, afterState: { operation: "reschedule", taskId, fromDate: originDate, toDate: date, blockId: originDate === date ? block.id : targetBlock.id, toStartMinutes: proposal.placement!.startMinutes, moves: proposal.moves }, status: "applied" });
    });
    return { taskId, date, startMinutes, proposal: { ...proposal, decision: "auto" }, snapshot: await this.getSnapshot(date), changeSetId };
  }

  async deleteTask(taskId: string) {
    const db = getDb();
    const rows = await db.select({ date: tasks.date }).from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId)));
    if (rows.length === 0) throw new Error("TASK_NOT_FOUND");
    const recurrenceRows = await db.select({ id: recurrenceRules.id }).from(recurrenceRules).where(eq(recurrenceRules.taskId, taskId));
    const recurrenceIds = recurrenceRows.map((row) => row.id);
    const occurrenceRows = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.source, "recurrence"), like(tasks.id, `${taskId}@%`)));
    const occurrenceIds = occurrenceRows.map((row) => row.id);
    await db.transaction(async (tx) => {
      if (recurrenceIds.length > 0) {
        await tx.delete(occurrenceOverrides).where(inArray(occurrenceOverrides.recurrenceId, recurrenceIds));
        await tx.delete(recurrenceRules).where(inArray(recurrenceRules.id, recurrenceIds));
      }
      if (occurrenceIds.length > 0) {
        await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), inArray(reminders.taskId, occurrenceIds)));
        await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), inArray(scheduleBlocks.taskId, occurrenceIds)));
        await tx.delete(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), inArray(tasks.id, occurrenceIds)));
      }
      await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, taskId)));
      await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.taskId, taskId)));
      await tx.delete(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, taskId)));
    });
    return this.getSnapshot(rows[0].date);
  }

  async undoChangeSet(changeSetId: string) {
    const db = getDb();
    const rows = await db.select().from(changeSets).where(and(eq(changeSets.workspaceId, WORKSPACE_ID), eq(changeSets.id, changeSetId)));
    const change = rows[0];
    if (!change || change.status !== "applied") throw new Error("CHANGE_SET_NOT_FOUND");
    const afterState = change.afterState as { operation?: string; action?: DailyCloseAction; date?: string; targetDate?: string; fromDate?: string; toDate?: string; taskId?: string; taskIds?: string[]; blockId?: string; blockIds?: string[]; moves?: Array<{ blockId: string }> };
    const beforeState = change.beforeState as { operation?: string; action?: DailyCloseAction; date?: string; targetDate?: string; fromDate?: string; toDate?: string; taskId?: string; taskIds?: string[]; blockId?: string; blocks?: ScheduledBlock[]; fromStartMinutes?: number; preferredStartMinutes?: number | null; durationMinutes?: number; kind?: ScheduleTask["kind"]; movable?: boolean; title?: string; status?: ScheduleTask["status"]; priority?: ScheduleTask["priority"]; reminderPolicy?: ScheduleTask["reminderPolicy"]; notes?: string | null; moves?: Array<{ blockId: string; fromStartMinutes: number }> };
    await db.transaction(async (tx) => {
      await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), like(reminders.dedupeKey, `change:${changeSetId}:%`)));
      if (beforeState.operation === "task_update" && beforeState.taskId) {
        await tx.update(tasks).set({ title: beforeState.title, status: beforeState.status, priority: beforeState.priority, reminderPolicy: beforeState.reminderPolicy, notes: beforeState.notes, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, beforeState.taskId)));
        const [restoredTask] = await tx.select().from(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, beforeState.taskId))).limit(1);
        const [restoredBlock] = await tx.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.taskId, beforeState.taskId))).limit(1);
        if (restoredTask && restoredBlock) {
          await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, beforeState.taskId), eq(reminders.kind, "start"), eq(reminders.status, "pending")));
          await enqueueStartReminder(tx, toBlock(restoredBlock, restoredTask), toTask(restoredTask));
        }
      } else if (beforeState.operation === "place" && beforeState.taskId) {
        await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, beforeState.taskId)));
        if (afterState.blockId) await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.id, afterState.blockId)));
        await tx.update(tasks).set({ date: beforeState.fromDate ?? beforeState.date, preferredStartMinutes: beforeState.preferredStartMinutes ?? null, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, beforeState.taskId)));
      } else if (beforeState.operation === "arrange_batch") {
        const taskIds = afterState.taskIds ?? [];
        const blockIds = afterState.blockIds ?? [];
        if (taskIds.length > 0) await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), inArray(reminders.taskId, taskIds)));
        if (blockIds.length > 0) await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), inArray(scheduleBlocks.id, blockIds)));
      } else if (beforeState.operation === "daily_close") {
        const taskIds = beforeState.taskIds ?? [];
        if (taskIds.length > 0) {
          await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), inArray(reminders.taskId, taskIds)));
          if (beforeState.action === "move_tomorrow" && beforeState.date) await tx.update(tasks).set({ date: beforeState.date, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), inArray(tasks.id, taskIds)));
        }
        for (const block of beforeState.blocks ?? []) {
          await tx.insert(scheduleBlocks).values({ id: block.id, workspaceId: WORKSPACE_ID, taskId: block.taskId, date: block.date, startMinutes: block.startMinutes, durationMinutes: block.durationMinutes, kind: block.kind, movable: block.movable }).onConflictDoNothing();
          await enqueueStartReminder(tx, block);
        }
      } else if (beforeState.operation === "reschedule" && beforeState.blockId && beforeState.taskId) {
        await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, beforeState.taskId)));
        const fromDate = beforeState.fromDate ?? beforeState.date;
        const toDate = beforeState.toDate ?? beforeState.date;
        if (fromDate && toDate && fromDate !== toDate) {
          if (afterState.blockId) await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.id, afterState.blockId)));
          await tx.update(tasks).set({ date: fromDate, updatedAt: new Date() }).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, beforeState.taskId)));
          await tx.insert(scheduleBlocks).values({ id: beforeState.blockId, workspaceId: WORKSPACE_ID, taskId: beforeState.taskId, date: fromDate, startMinutes: beforeState.fromStartMinutes ?? 0, durationMinutes: beforeState.durationMinutes ?? 0, kind: beforeState.kind ?? "flexible", movable: beforeState.movable ?? true }).onConflictDoNothing();
          await enqueueStartReminder(tx, { id: beforeState.blockId, taskId: beforeState.taskId, date: fromDate, startMinutes: beforeState.fromStartMinutes ?? 0, durationMinutes: beforeState.durationMinutes ?? 0, kind: beforeState.kind ?? "flexible", movable: beforeState.movable ?? true, title: beforeState.title ?? beforeState.taskId });
        } else {
          const [restoredBlock] = await tx.update(scheduleBlocks).set({ startMinutes: beforeState.fromStartMinutes, durationMinutes: beforeState.durationMinutes, updatedAt: new Date() }).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.id, beforeState.blockId))).returning();
          if (restoredBlock) await enqueueStartReminder(tx, { ...toBlock(restoredBlock), title: beforeState.title ?? beforeState.taskId });
        }
      } else if (afterState.taskId) {
        await tx.delete(reminders).where(and(eq(reminders.workspaceId, WORKSPACE_ID), eq(reminders.taskId, afterState.taskId)));
        await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.workspaceId, WORKSPACE_ID), eq(scheduleBlocks.taskId, afterState.taskId)));
        await tx.delete(tasks).where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.id, afterState.taskId)));
      }
      for (const move of beforeState.moves ?? []) {
        await tx.update(scheduleBlocks).set({ startMinutes: move.fromStartMinutes, updatedAt: new Date() }).where(eq(scheduleBlocks.id, move.blockId));
      }
      await tx.update(changeSets).set({ status: "undone", updatedAt: new Date() }).where(and(eq(changeSets.workspaceId, WORKSPACE_ID), eq(changeSets.id, changeSetId)));
    });
    return this.getSnapshot(beforeState.fromDate ?? beforeState.date ?? afterState.fromDate ?? afterState.date ?? "");
  }
}

export const sqliteScheduleStore = new SqliteScheduleStore();
