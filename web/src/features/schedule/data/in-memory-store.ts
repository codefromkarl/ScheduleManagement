import { findScheduleProposal, placementToBlock } from "../domain/scheduler";
import type { ScheduledBlock, ScheduleTask } from "../domain/types";
import { rankUnplannedTasks } from "../domain/unplanned";
import { createDemoSnapshot } from "./demo-snapshot";
import type { ArrangeUnplannedResult, DailyCloseAction, DailyCloseResult, InsertTaskResult, RescheduleTaskOptions, RescheduleTaskResult, ScheduleExistingTaskOptions, ScheduleExistingTaskResult, ScheduleMutationOptions, ScheduleStore } from "./store-types";
import type { ScheduleSnapshot } from "./types";
import { randomUUID } from "node:crypto";

export type { InsertTaskResult } from "./store-types";

function cloneSnapshot(snapshot: ScheduleSnapshot): ScheduleSnapshot {
  return structuredClone(snapshot);
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

type InMemoryChange = {
  kind: "insert" | "place" | "reschedule" | "arrange_batch" | "daily_close";
  date: string;
  taskId?: string;
  taskIds?: string[];
  targetDate?: string;
  blockId?: string;
  blockIds?: string[];
  blocks?: ScheduledBlock[];
  fromStartMinutes?: number;
  moves: Array<{ blockId: string; fromStartMinutes: number }>;
};

export class InMemoryScheduleStore implements ScheduleStore {
  private readonly snapshots = new Map<string, ScheduleSnapshot>();
  private readonly changes = new Map<string, InMemoryChange>();

  private locateTask(taskId: string) {
    for (const [date, snapshot] of this.snapshots.entries()) {
      const task = snapshot.tasks.find((item) => item.id === taskId && item.date === date);
      if (task) return { date, snapshot, task, block: snapshot.blocks.find((item) => item.taskId === taskId && item.date === date) };
    }
    return null;
  }

  async getSnapshot(date: string) {
    const snapshot = this.snapshots.get(date) ?? createDemoSnapshot(date);
    this.snapshots.set(date, snapshot);
    return cloneSnapshot(snapshot);
  }

  async getUnplannedTasks() {
    const seen = new Set<string>();
    const result: ScheduleTask[] = [];
    for (const snapshot of this.snapshots.values()) {
      const scheduled = new Set(snapshot.blocks.map((block) => block.taskId));
      for (const task of snapshot.tasks) {
        if (task.status === "done" || scheduled.has(task.id) || seen.has(task.id)) continue;
        seen.add(task.id);
        result.push(structuredClone(task));
      }
    }
    return rankUnplannedTasks(result);
  }

  async insertTask(task: ScheduleTask, options: ScheduleMutationOptions = {}): Promise<InsertTaskResult> {
    const current = await this.getSnapshot(task.date);
    const proposal = findScheduleProposal(task, {
      date: current.date,
      availability: current.availability,
      unavailable: current.unavailable,
      existing: current.blocks,
      bufferMinutes: current.bufferMinutes,
      mode: options.mode ?? "rules",
    });

    if (proposal.decision === "auto" && proposal.placement) {
      current.tasks.push(task);
      current.blocks.push(placementToBlock(task, proposal.placement));
      this.snapshots.set(task.date, current);
      const changeSetId = randomUUID();
      this.changes.set(changeSetId, { kind: "insert", date: task.date, taskId: task.id, moves: [] });
      return { proposal, snapshot: cloneSnapshot(current), changeSetId };
    }

    if (proposal.decision === "no_slot") {
      current.tasks.push(task);
      this.snapshots.set(task.date, current);
      const changeSetId = randomUUID();
      this.changes.set(changeSetId, { kind: "insert", date: task.date, taskId: task.id, moves: [] });
      return { proposal, snapshot: cloneSnapshot(current), changeSetId };
    }

    return { proposal, snapshot: cloneSnapshot(this.snapshots.get(task.date) ?? current) };
  }

  async confirmTask(task: ScheduleTask, options: ScheduleMutationOptions = {}): Promise<InsertTaskResult> {
    const current = await this.getSnapshot(task.date);
    const proposal = findScheduleProposal(task, {
      date: current.date,
      availability: current.availability,
      unavailable: current.unavailable,
      existing: current.blocks,
      bufferMinutes: current.bufferMinutes,
      mode: options.mode ?? "optimize",
    });
    if ((proposal.decision !== "needs_confirmation" && proposal.decision !== "auto") || !proposal.placement) {
      return { proposal, snapshot: current };
    }
    for (const move of proposal.moves) {
      const block = current.blocks.find((item) => item.id === move.blockId);
      if (block) block.startMinutes = move.toStartMinutes;
    }
    current.tasks.push(task);
    current.blocks.push(placementToBlock(task, proposal.placement));
    this.snapshots.set(task.date, current);
    const changeSetId = randomUUID();
    this.changes.set(changeSetId, { kind: "insert", date: task.date, taskId: task.id, moves: proposal.moves.map((move) => ({ blockId: move.blockId, fromStartMinutes: move.fromStartMinutes })) });
    return { proposal: { ...proposal, decision: "auto" }, snapshot: cloneSnapshot(current), changeSetId };
  }

  async scheduleTask(taskId: string, date: string, options: ScheduleExistingTaskOptions): Promise<ScheduleExistingTaskResult> {
    const located = this.locateTask(taskId);
    const current = await this.getSnapshot(date);
    if (!located) return { taskId, date, proposal: { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务不存在。"] }, snapshot: current };
    if (located.block) {
      return { taskId, date, proposal: { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务已经排入日程，请使用改期操作。"] }, snapshot: current };
    }
    const targetEnd = options.startMinutes === undefined ? undefined : options.startMinutes + located.task.estimatedMinutes;
    const probe = {
      ...located.task,
      date,
      exactStartMinutes: options.startMinutes,
      deadlineMinutes: targetEnd === undefined ? located.task.deadlineMinutes : located.task.deadlineMinutes === undefined ? targetEnd : Math.min(located.task.deadlineMinutes, targetEnd),
    };
    const proposal = findScheduleProposal(probe, { date, availability: current.availability, unavailable: current.unavailable, existing: current.blocks, bufferMinutes: current.bufferMinutes, mode: options.mode ?? "rules" });
    if (proposal.decision === "needs_confirmation" && !options.confirm) return { taskId, date, proposal, snapshot: current };
    if ((proposal.decision !== "auto" && !(options.confirm && proposal.decision === "needs_confirmation")) || !proposal.placement) return { taskId, date, proposal, snapshot: current };
    for (const move of proposal.moves) {
      const movedBlock = current.blocks.find((item) => item.id === move.blockId);
      if (movedBlock) movedBlock.startMinutes = move.toStartMinutes;
    }
    const block = placementToBlock(probe, proposal.placement);
    if (located.date !== date) {
      located.snapshot.tasks = located.snapshot.tasks.filter((item) => item.id !== taskId);
      current.tasks = current.tasks.filter((item) => item.id !== taskId);
      current.tasks.push({ ...located.task, date });
      this.snapshots.set(located.date, located.snapshot);
    }
    current.blocks.push(block);
    this.snapshots.set(date, current);
    const changeSetId = randomUUID();
    this.changes.set(changeSetId, { kind: "place", date: located.date, targetDate: date, taskId, blockId: block.id, moves: proposal.moves.map((move) => ({ blockId: move.blockId, fromStartMinutes: move.fromStartMinutes })) });
    return { taskId, date, proposal: { ...proposal, decision: "auto" }, snapshot: cloneSnapshot(current), changeSetId };
  }

  async arrangeUnplanned(date: string): Promise<ArrangeUnplannedResult> {
    const current = await this.getSnapshot(date);
    const scheduledIds = new Set(current.blocks.map((block) => block.taskId));
    const queue = rankUnplannedTasks(current.tasks.filter((task) => task.status !== "done" && !scheduledIds.has(task.id)));
    const workingBlocks = [...current.blocks];
    const blocks: ScheduledBlock[] = [];

    for (const task of queue) {
      const proposal = findScheduleProposal(task, { date, availability: current.availability, unavailable: current.unavailable, existing: workingBlocks, bufferMinutes: current.bufferMinutes, mode: "rules" });
      if (proposal.decision !== "auto" || !proposal.placement) continue;
      const block = placementToBlock(task, proposal.placement);
      blocks.push(block);
      workingBlocks.push(block);
    }

    if (blocks.length === 0) return { date, arrangedTaskIds: [], remainingTaskIds: queue.map((task) => task.id), snapshot: current };
    current.blocks.push(...blocks);
    this.snapshots.set(date, current);
    const changeSetId = randomUUID();
    this.changes.set(changeSetId, { kind: "arrange_batch", date, taskIds: blocks.map((block) => block.taskId), blockIds: blocks.map((block) => block.id), moves: [] });
    const arrangedIds = new Set(blocks.map((block) => block.taskId));
    return { date, arrangedTaskIds: [...arrangedIds], remainingTaskIds: queue.filter((task) => !arrangedIds.has(task.id)).map((task) => task.id), snapshot: cloneSnapshot(current), changeSetId };
  }

  async closeDay(date: string, action: DailyCloseAction): Promise<DailyCloseResult> {
    const current = await this.getSnapshot(date);
    const taskIds = current.tasks.filter((task) => task.status !== "done" && task.kind !== "fixed").map((task) => task.id);
    const taskIdSet = new Set(taskIds);
    const blocks = current.blocks.filter((block) => taskIdSet.has(block.taskId));
    const targetDate = action === "move_tomorrow" ? nextDate(date) : date;
    if (taskIds.length === 0) return { date, targetDate, action, affectedTaskIds: [], snapshot: current };

    current.blocks = current.blocks.filter((block) => !taskIdSet.has(block.taskId));
    if (action === "move_tomorrow") {
      const movedTasks = current.tasks.filter((task) => taskIdSet.has(task.id)).map((task) => ({ ...task, date: targetDate }));
      current.tasks = current.tasks.filter((task) => !taskIdSet.has(task.id));
      const target = await this.getSnapshot(targetDate);
      target.tasks.push(...movedTasks);
      this.snapshots.set(targetDate, target);
    }
    this.snapshots.set(date, current);
    const changeSetId = randomUUID();
    this.changes.set(changeSetId, { kind: "daily_close", date, targetDate, taskIds, blocks: structuredClone(blocks), moves: [] });
    const snapshot = action === "move_tomorrow" ? await this.getSnapshot(targetDate) : current;
    return { date, targetDate, action, affectedTaskIds: taskIds, snapshot: cloneSnapshot(snapshot), changeSetId };
  }

  async rescheduleTask(taskId: string, date: string, startMinutes: number, options: RescheduleTaskOptions = {}): Promise<RescheduleTaskResult> {
    const located = this.locateTask(taskId);
    const current = await this.getSnapshot(date);
    if (!located?.block) return { taskId, date, startMinutes, proposal: { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务没有可调整的日程块。"] }, snapshot: current };
    const targetTask = { ...located.task, date, exactStartMinutes: startMinutes, deadlineMinutes: located.task.deadlineMinutes === undefined ? startMinutes + located.task.estimatedMinutes : Math.min(located.task.deadlineMinutes, startMinutes + located.task.estimatedMinutes) };
    const proposal = findScheduleProposal(targetTask, { date, availability: current.availability, unavailable: current.unavailable, existing: located.date === date ? current.blocks.filter((item) => item.id !== located.block!.id) : current.blocks, bufferMinutes: current.bufferMinutes, mode: options.mode ?? "rules" });
    if (proposal.decision === "needs_confirmation" && !options.confirm) return { taskId, date, startMinutes, proposal, snapshot: current };
    if ((proposal.decision !== "auto" && !(options.confirm && proposal.decision === "needs_confirmation")) || !proposal.placement) return { taskId, date, startMinutes, proposal, snapshot: current };
    const fromStartMinutes = located.block.startMinutes;
    for (const move of proposal.moves) {
      const movedBlock = current.blocks.find((item) => item.id === move.blockId);
      if (movedBlock) movedBlock.startMinutes = move.toStartMinutes;
    }
    if (located.date === date) {
      const currentBlock = current.blocks.find((item) => item.id === located.block!.id);
      if (currentBlock) currentBlock.startMinutes = proposal.placement.startMinutes;
    } else {
      const targetBlock = placementToBlock(targetTask, proposal.placement);
      located.snapshot.tasks = located.snapshot.tasks.filter((item) => item.id !== taskId);
      located.snapshot.blocks = located.snapshot.blocks.filter((item) => item.id !== located.block!.id);
      current.tasks = current.tasks.filter((item) => item.id !== taskId);
      current.blocks = current.blocks.filter((item) => item.taskId !== taskId);
      current.tasks.push({ ...located.task, date });
      current.blocks.push(targetBlock);
      this.snapshots.set(located.date, located.snapshot);
    }
    const changeSetId = randomUUID();
    this.changes.set(changeSetId, { kind: "reschedule", date: located.date, targetDate: date, taskId, blockId: located.block.id, blocks: [structuredClone(located.block)], fromStartMinutes, moves: proposal.moves.map((move) => ({ blockId: move.blockId, fromStartMinutes: move.fromStartMinutes })) });
    this.snapshots.set(date, current);
    return { taskId, date, startMinutes, proposal: { ...proposal, decision: "auto" }, snapshot: cloneSnapshot(current), changeSetId };
  }

  async updateTask(taskId: string, changes: Partial<Pick<ScheduleTask, "title" | "status" | "priority" | "reminderPolicy" | "notes">>) {
    for (const [date, snapshot] of this.snapshots.entries()) {
      const task = snapshot.tasks.find((item) => item.id === taskId);
      if (!task) continue;
      Object.assign(task, changes);
      this.snapshots.set(date, snapshot);
      return cloneSnapshot(snapshot);
    }
    throw new Error("TASK_NOT_FOUND");
  }

  async deleteTask(taskId: string) {
    for (const [date, snapshot] of this.snapshots.entries()) {
      if (!snapshot.tasks.some((item) => item.id === taskId)) continue;
      snapshot.tasks = snapshot.tasks.filter((item) => item.id !== taskId);
      snapshot.blocks = snapshot.blocks.filter((item) => item.taskId !== taskId);
      this.snapshots.set(date, snapshot);
      return cloneSnapshot(snapshot);
    }
    throw new Error("TASK_NOT_FOUND");
  }

  async undoChangeSet(changeSetId: string) {
    const change = this.changes.get(changeSetId);
    if (!change) throw new Error("CHANGE_SET_NOT_FOUND");
    const snapshot = await this.getSnapshot(change.date);
    let moveTarget: { date: string; snapshot: ScheduleSnapshot } | null = null;
    if (change.kind === "insert") {
      snapshot.tasks = snapshot.tasks.filter((task) => task.id !== change.taskId);
      snapshot.blocks = snapshot.blocks.filter((block) => block.taskId !== change.taskId);
    } else if ((change.kind === "place" || change.kind === "reschedule") && change.targetDate && change.targetDate !== change.date && change.taskId) {
      const target = await this.getSnapshot(change.targetDate);
      const movedTask = target.tasks.find((task) => task.id === change.taskId);
      target.tasks = target.tasks.filter((task) => task.id !== change.taskId);
      target.blocks = target.blocks.filter((block) => block.taskId !== change.taskId);
      snapshot.tasks = snapshot.tasks.filter((task) => task.id !== change.taskId);
      if (movedTask) snapshot.tasks.push({ ...movedTask, date: change.date });
      if (change.kind === "reschedule") snapshot.blocks.push(...(change.blocks ?? []));
      moveTarget = { date: change.targetDate, snapshot: target };
    } else if (change.kind === "place") {
      snapshot.blocks = snapshot.blocks.filter((block) => block.id !== change.blockId);
    } else if (change.kind === "arrange_batch") {
      const blockIds = new Set(change.blockIds ?? []);
      snapshot.blocks = snapshot.blocks.filter((block) => !blockIds.has(block.id));
    } else if (change.kind === "daily_close") {
      const taskIds = new Set(change.taskIds ?? []);
      if (change.targetDate && change.targetDate !== change.date) {
        const target = await this.getSnapshot(change.targetDate);
        const movedTasks = target.tasks.filter((task) => taskIds.has(task.id)).map((task) => ({ ...task, date: change.date }));
        target.tasks = target.tasks.filter((task) => !taskIds.has(task.id));
        target.blocks = target.blocks.filter((block) => !taskIds.has(block.taskId));
        snapshot.tasks.push(...movedTasks);
        this.snapshots.set(change.targetDate, target);
      }
      snapshot.blocks.push(...(change.blocks ?? []));
    } else if (change.blockId && change.fromStartMinutes !== undefined) {
      const block = snapshot.blocks.find((item) => item.id === change.blockId);
      if (block) block.startMinutes = change.fromStartMinutes;
    }
    for (const move of change.moves) {
      const block = (moveTarget?.snapshot ?? snapshot).blocks.find((item) => item.id === move.blockId);
      if (block) block.startMinutes = move.fromStartMinutes;
    }
    if (moveTarget) this.snapshots.set(moveTarget.date, moveTarget.snapshot);
    this.snapshots.set(change.date, snapshot);
    this.changes.delete(changeSetId);
    return cloneSnapshot(snapshot);
  }
}

const globalForSchedule = globalThis as unknown as { goalsetScheduleStore?: InMemoryScheduleStore };
export const scheduleStore = globalForSchedule.goalsetScheduleStore ?? new InMemoryScheduleStore();
globalForSchedule.goalsetScheduleStore = scheduleStore;
