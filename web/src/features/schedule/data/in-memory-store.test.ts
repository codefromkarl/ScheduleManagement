import { describe, expect, it } from "vitest";
import { InMemoryScheduleStore } from "./in-memory-store";
import type { ScheduleTask } from "../domain/types";

async function clearDate(store: InMemoryScheduleStore, date: string) {
  const snapshot = await store.getSnapshot(date);
  for (const task of snapshot.tasks) await store.deleteTask(task.id);
}

describe("InMemoryScheduleStore unplanned flow", () => {
  it("returns range snapshots in the requested order", async () => {
    const store = new InMemoryScheduleStore();
    const dates = ["2026-08-22", "2026-08-21", "2026-08-22"];
    expect((await store.getSnapshots(dates)).map((snapshot) => snapshot.date)).toEqual(dates);
  });

  it("persists a no-slot task without moving existing blocks, then places it at an explicit safe time", async () => {
    const store = new InMemoryScheduleStore();
    const date = "2026-08-21";
    const task: ScheduleTask = {
      id: "unplanned-fixed",
      title: "待安排固定任务",
      date,
      kind: "fixed",
      status: "todo",
      priority: "normal",
      reminderPolicy: "auto",
      estimatedMinutes: 15,
      movable: false,
      preferredStartMinutes: 9 * 60,
    };

    const before = await store.getSnapshot(date);
    const inserted = await store.insertTask(task);
    expect(inserted.proposal.decision).toBe("no_slot");
    expect(inserted.snapshot.tasks.some((item) => item.id === task.id)).toBe(true);
    expect(inserted.snapshot.blocks).toEqual(before.blocks);

    const placed = await store.scheduleTask(task.id, date, { mode: "rules", startMinutes: 14 * 60 + 30 });
    expect(placed.proposal.decision).toBe("auto");
    expect(placed.snapshot.blocks.find((block) => block.taskId === task.id)?.startMinutes).toBe(14 * 60 + 30);
  });

  it("arranges all currently safe unplanned tasks as one reversible batch", async () => {
    const store = new InMemoryScheduleStore();
    const date = "2026-08-21";
    const task: ScheduleTask = { id: "batch-task", title: "批量待安排", date, kind: "flexible", status: "todo", priority: "high", reminderPolicy: "auto", estimatedMinutes: 60, movable: true, preferredStartMinutes: 9 * 60, deadlineMinutes: 10 * 60 };
    const inserted = await store.insertTask(task);
    expect(inserted.proposal.decision).toBe("no_slot");
    await store.deleteTask("weekly-sync");

    const arranged = await store.arrangeUnplanned(date);
    expect(arranged.arrangedTaskIds).toEqual([task.id]);
    expect(arranged.snapshot.blocks.find((block) => block.taskId === task.id)?.startMinutes).toBe(9 * 60);

    const undone = await store.undoChangeSet(arranged.changeSetId!);
    expect(undone.tasks.some((item) => item.id === task.id)).toBe(true);
    expect(undone.blocks.some((block) => block.taskId === task.id)).toBe(false);
  });

  it("closes a day without moving fixed work and can undo the batch", async () => {
    const store = new InMemoryScheduleStore();
    const date = "2026-08-21";
    const before = await store.getSnapshot(date);
    const result = await store.closeDay(date, "unplan");
    expect(result.affectedTaskIds.length).toBeGreaterThan(0);
    expect(result.snapshot.blocks.every((block) => block.kind === "fixed" || !result.affectedTaskIds.includes(block.taskId))).toBe(true);
    expect(result.snapshot.blocks.some((block) => block.kind === "fixed")).toBe(true);

    const undone = await store.undoChangeSet(result.changeSetId!);
    expect(undone.blocks).toHaveLength(before.blocks.length);
  });

  it("moves a scheduled task across dates and restores the origin on undo", async () => {
    const store = new InMemoryScheduleStore();
    const originDate = "2026-08-21";
    const targetDate = "2026-08-22";
    await clearDate(store, originDate);
    await clearDate(store, targetDate);
    const task: ScheduleTask = { id: "cross-date-scheduled", title: "跨日改期", date: originDate, kind: "flexible", status: "todo", priority: "normal", reminderPolicy: "auto", estimatedMinutes: 30, movable: true, preferredStartMinutes: 9 * 60 };
    const inserted = await store.insertTask(task);
    expect(inserted.proposal.decision).toBe("auto");

    const moved = await store.rescheduleTask(task.id, targetDate, 10 * 60);
    expect(moved.proposal.decision).toBe("auto");
    expect(moved.snapshot.tasks.find((item) => item.id === task.id)?.date).toBe(targetDate);
    expect(moved.snapshot.blocks.find((block) => block.taskId === task.id)?.startMinutes).toBe(10 * 60);
    expect((await store.getSnapshot(originDate)).tasks.some((item) => item.id === task.id)).toBe(false);

    const restored = await store.undoChangeSet(moved.changeSetId!);
    expect(restored.tasks.find((item) => item.id === task.id)?.date).toBe(originDate);
    expect(restored.blocks.find((block) => block.taskId === task.id)?.startMinutes).toBe(9 * 60);
    expect((await store.getSnapshot(targetDate)).tasks.some((item) => item.id === task.id)).toBe(false);
  });

  it("places an unplanned task on another date and restores its original date on undo", async () => {
    const store = new InMemoryScheduleStore();
    const originDate = "2026-08-21";
    const targetDate = "2026-08-22";
    await clearDate(store, originDate);
    await clearDate(store, targetDate);
    const blocker: ScheduleTask = { id: "cross-date-blocker", title: "阻挡时段", date: originDate, kind: "fixed", status: "todo", priority: "normal", reminderPolicy: "auto", estimatedMinutes: 60, movable: false, preferredStartMinutes: 9 * 60 };
    const task: ScheduleTask = { id: "cross-date-unplanned", title: "跨日待安排", date: originDate, kind: "fixed", status: "todo", priority: "high", reminderPolicy: "auto", estimatedMinutes: 30, movable: false, preferredStartMinutes: 9 * 60 };
    await store.insertTask(blocker);
    const inserted = await store.insertTask(task);
    expect(inserted.proposal.decision).toBe("no_slot");
    await store.deleteTask(blocker.id);

    const placed = await store.scheduleTask(task.id, targetDate, { mode: "rules", startMinutes: 11 * 60 });
    expect(placed.proposal.decision).toBe("auto");
    expect(placed.snapshot.tasks.find((item) => item.id === task.id)?.date).toBe(targetDate);
    expect(placed.snapshot.blocks.find((block) => block.taskId === task.id)?.startMinutes).toBe(11 * 60);

    const restored = await store.undoChangeSet(placed.changeSetId!);
    expect(restored.tasks.find((item) => item.id === task.id)?.date).toBe(originDate);
    expect(restored.blocks.some((block) => block.taskId === task.id)).toBe(false);
    expect((await store.getSnapshot(targetDate)).tasks.some((item) => item.id === task.id)).toBe(false);
  });
});
