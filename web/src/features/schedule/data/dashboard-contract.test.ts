import { describe, expect, it } from "vitest";
import { calculateDailyCapacity } from "../domain/capacity";
import { createDemoSnapshot } from "./demo-snapshot";
import { dashboardResponseSchema, dateKeysInRange, scheduleRangeQuerySchema } from "./contract";

describe("dashboard range contract", () => {
  it("creates an inclusive, bounded list of calendar keys", () => {
    expect(dateKeysInRange("2026-08-17", "2026-08-23")).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
    expect(scheduleRangeQuerySchema.safeParse({ from: "2026-08-23", to: "2026-08-17" }).success).toBe(false);
    expect(scheduleRangeQuerySchema.safeParse({ from: "2026-08-01", to: "2026-09-01" }).success).toBe(false);
  });

  it("validates the shared schedule, capacity, and unplanned payload", () => {
    const snapshot = createDemoSnapshot("2026-08-21");
    const response = dashboardResponseSchema.parse({ snapshots: [snapshot], capacityDays: [calculateDailyCapacity(snapshot)], unplannedTasks: [] });
    expect(response.snapshots[0].date).toBe(snapshot.date);
    expect(response.capacityDays[0].date).toBe(snapshot.date);
  });
});
