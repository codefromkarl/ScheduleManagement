import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "./data/demo-snapshot";
import { unplannedTasksFromSnapshot } from "./model";

describe("unplannedTasksFromSnapshot", () => {
  it("returns only unscheduled active tasks and ranks priority before deadline", () => {
    const snapshot = createDemoSnapshot("2026-08-21");
    snapshot.tasks.push(
      { id: "normal-early", title: "普通临近截止", date: snapshot.date, kind: "floating", status: "todo", priority: "normal", reminderPolicy: "auto", estimatedMinutes: 30, movable: true, deadlineMinutes: 10 * 60 },
      { id: "high-late", title: "重要稍晚截止", date: snapshot.date, kind: "flexible", status: "todo", priority: "high", reminderPolicy: "auto", estimatedMinutes: 45, movable: true, deadlineMinutes: 17 * 60 },
      { id: "done-unplanned", title: "已完成未排期", date: snapshot.date, kind: "floating", status: "done", priority: "high", reminderPolicy: "auto", estimatedMinutes: 15, movable: true },
    );

    expect(unplannedTasksFromSnapshot(snapshot).map((task) => task.id)).toEqual(["high-late", "normal-early"]);
  });
});
