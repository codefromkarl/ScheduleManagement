import { describe, expect, it } from "vitest";
import { InMemoryScheduleStore } from "./in-memory-store";
import type { ScheduleTask } from "../domain/types";

describe("InMemoryScheduleStore unplanned flow", () => {
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
});
