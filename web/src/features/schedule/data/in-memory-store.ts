import { findScheduleProposal, placementToBlock } from "../domain/scheduler";
import type { ScheduleTask } from "../domain/types";
import { createDemoSnapshot } from "./demo-snapshot";
import type { InsertTaskResult, RescheduleTaskOptions, RescheduleTaskResult, ScheduleExistingTaskOptions, ScheduleExistingTaskResult, ScheduleMutationOptions, ScheduleStore } from "./store-types";
import type { ScheduleSnapshot } from "./types";
import { randomUUID } from "node:crypto";

export type { InsertTaskResult } from "./store-types";

function cloneSnapshot(snapshot: ScheduleSnapshot): ScheduleSnapshot {
  return structuredClone(snapshot);
}

export class InMemoryScheduleStore implements ScheduleStore {
  private readonly snapshots = new Map<string, ScheduleSnapshot>();
  private readonly changes = new Map<string, { kind: "insert" | "place" | "reschedule"; date: string; taskId: string; blockId?: string; fromStartMinutes?: number; moves: Array<{ blockId: string; fromStartMinutes: number }> }>();

  async getSnapshot(date: string) {
    const snapshot = this.snapshots.get(date) ?? createDemoSnapshot(date);
    this.snapshots.set(date, snapshot);
    return cloneSnapshot(snapshot);
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
    const current = await this.getSnapshot(date);
    const task = current.tasks.find((item) => item.id === taskId);
    if (!task) return { taskId, date, proposal: { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务不存在或不属于当前日期。"] }, snapshot: current };
    if (current.blocks.some((item) => item.taskId === taskId)) {
      return { taskId, date, proposal: { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务已经排入日程，请使用改期操作。"] }, snapshot: current };
    }
    const targetEnd = options.startMinutes === undefined ? undefined : options.startMinutes + task.estimatedMinutes;
    const probe = {
      ...task,
      date,
      exactStartMinutes: options.startMinutes,
      deadlineMinutes: targetEnd === undefined ? task.deadlineMinutes : task.deadlineMinutes === undefined ? targetEnd : Math.min(task.deadlineMinutes, targetEnd),
    };
    const proposal = findScheduleProposal(probe, { date, availability: current.availability, unavailable: current.unavailable, existing: current.blocks, bufferMinutes: current.bufferMinutes, mode: options.mode ?? "rules" });
    if (proposal.decision === "needs_confirmation" && !options.confirm) return { taskId, date, proposal, snapshot: current };
    if ((proposal.decision !== "auto" && !(options.confirm && proposal.decision === "needs_confirmation")) || !proposal.placement) return { taskId, date, proposal, snapshot: current };
    for (const move of proposal.moves) {
      const movedBlock = current.blocks.find((item) => item.id === move.blockId);
      if (movedBlock) movedBlock.startMinutes = move.toStartMinutes;
    }
    const block = placementToBlock(probe, proposal.placement);
    current.blocks.push(block);
    this.snapshots.set(date, current);
    const changeSetId = randomUUID();
    this.changes.set(changeSetId, { kind: "place", date, taskId, blockId: block.id, moves: proposal.moves.map((move) => ({ blockId: move.blockId, fromStartMinutes: move.fromStartMinutes })) });
    return { taskId, date, proposal: { ...proposal, decision: "auto" }, snapshot: cloneSnapshot(current), changeSetId };
  }

  async rescheduleTask(taskId: string, date: string, startMinutes: number, options: RescheduleTaskOptions = {}): Promise<RescheduleTaskResult> {
    const current = await this.getSnapshot(date);
    const task = current.tasks.find((item) => item.id === taskId);
    const block = current.blocks.find((item) => item.taskId === taskId && item.date === date);
    if (!task || !block) return { taskId, date, startMinutes, proposal: { decision: "needs_information", movedBlockIds: [], moves: [], reasons: ["任务没有可调整的日程块。"] }, snapshot: current };
    const probe = { ...task, exactStartMinutes: startMinutes, deadlineMinutes: task.deadlineMinutes === undefined ? startMinutes + task.estimatedMinutes : Math.min(task.deadlineMinutes, startMinutes + task.estimatedMinutes) };
    const proposal = findScheduleProposal(probe, { date, availability: current.availability, unavailable: current.unavailable, existing: current.blocks.filter((item) => item.id !== block.id), bufferMinutes: current.bufferMinutes, mode: options.mode ?? "rules" });
    if (proposal.decision === "needs_confirmation" && !options.confirm) return { taskId, date, startMinutes, proposal, snapshot: current };
    if ((proposal.decision !== "auto" && !(options.confirm && proposal.decision === "needs_confirmation")) || !proposal.placement) return { taskId, date, startMinutes, proposal, snapshot: current };
    const fromStartMinutes = block.startMinutes;
    for (const move of proposal.moves) {
      const movedBlock = current.blocks.find((item) => item.id === move.blockId);
      if (movedBlock) movedBlock.startMinutes = move.toStartMinutes;
    }
    block.startMinutes = proposal.placement.startMinutes;
    const changeSetId = randomUUID();
    this.changes.set(changeSetId, { kind: "reschedule", date, taskId, blockId: block.id, fromStartMinutes, moves: proposal.moves.map((move) => ({ blockId: move.blockId, fromStartMinutes: move.fromStartMinutes })) });
    this.snapshots.set(date, current);
    return { taskId, date, startMinutes, proposal: { ...proposal, decision: "auto" }, snapshot: cloneSnapshot(current), changeSetId };
  }

  async updateTask(taskId: string, changes: Partial<Pick<ScheduleTask, "title" | "status" | "priority" | "notes">>) {
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
    if (change.kind === "insert") {
      snapshot.tasks = snapshot.tasks.filter((task) => task.id !== change.taskId);
      snapshot.blocks = snapshot.blocks.filter((block) => block.taskId !== change.taskId);
    } else if (change.kind === "place") {
      snapshot.blocks = snapshot.blocks.filter((block) => block.id !== change.blockId);
    } else if (change.blockId && change.fromStartMinutes !== undefined) {
      const block = snapshot.blocks.find((item) => item.id === change.blockId);
      if (block) block.startMinutes = change.fromStartMinutes;
    }
    for (const move of change.moves) {
      const block = snapshot.blocks.find((item) => item.id === move.blockId);
      if (block) block.startMinutes = move.fromStartMinutes;
    }
    this.snapshots.set(change.date, snapshot);
    this.changes.delete(changeSetId);
    return cloneSnapshot(snapshot);
  }
}

const globalForSchedule = globalThis as unknown as { goalsetScheduleStore?: InMemoryScheduleStore };
export const scheduleStore = globalForSchedule.goalsetScheduleStore ?? new InMemoryScheduleStore();
globalForSchedule.goalsetScheduleStore = scheduleStore;
