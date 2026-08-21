import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../data/demo-snapshot";
import { calculateDailyCapacity } from "./capacity";
import { deriveTimelineRange, expandTimelineRange, timelineHours } from "./timeline";
import { groupUnplannedTasks } from "./unplanned-groups";
import type { ScheduleTask } from "./types";

describe("planning projections", () => {
  it("expands the timeline around early and late schedule data", () => {
    const snapshot = createDemoSnapshot("2026-08-21");
    snapshot.availability = [{ date: snapshot.date, startMinutes: 7 * 60 + 30, endMinutes: 22 * 60 + 15 }];
    expect(deriveTimelineRange(snapshot)).toEqual({ startMinutes: 7 * 60, endMinutes: 23 * 60 });
    expect(expandTimelineRange({ startMinutes: 8 * 60, endMinutes: 19 * 60 }, 6 * 60 + 45, 30)).toEqual({ startMinutes: 6 * 60, endMinutes: 19 * 60 });
    expect(timelineHours({ startMinutes: 8 * 60, endMinutes: 10 * 60 })).toEqual([8, 9, 10]);
  });

  it("reports impossible capacity when unplanned work exceeds safe slots", () => {
    const snapshot = createDemoSnapshot("2026-08-21");
    snapshot.availability = [{ date: snapshot.date, startMinutes: 9 * 60, endMinutes: 10 * 60 }];
    snapshot.blocks = [];
    snapshot.tasks = [{ id: "too-large", title: "超量工作", date: snapshot.date, kind: "floating", status: "todo", priority: "high", reminderPolicy: "auto", estimatedMinutes: 120, movable: true, deadlineMinutes: 10 * 60 }];
    const result = calculateDailyCapacity(snapshot);
    expect(result.status).toBe("impossible");
    expect(result.deficitMinutes).toBe(60);
    expect(result.deadlineRiskCount).toBe(1);
  });

  it("groups all-date unplanned tasks relative to today", () => {
    const base = (id: string, date: string): ScheduleTask => ({ id, title: id, date, kind: "floating", status: "todo", priority: "normal", reminderPolicy: "auto", estimatedMinutes: 30, movable: true });
    const groups = groupUnplannedTasks([base("old", "2026-08-20"), base("today", "2026-08-21"), base("tomorrow", "2026-08-22"), base("later", "2026-09-01")], "2026-08-21");
    expect(groups.map((group) => [group.key, group.tasks.map((task) => task.id)])).toEqual([["overdue", ["old"]], ["today", ["today"]], ["tomorrow", ["tomorrow"]], ["later", ["later"]]]);
  });
});
