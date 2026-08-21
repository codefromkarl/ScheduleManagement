import { describe, expect, it } from "vitest";
import { dailySummaryTime, reminderMessage, reminderReasonText } from "./reminders";

describe("reminder presentation and time policy", () => {
  it("schedules the risk summary at 09:00 Asia/Shanghai independent of host timezone", () => {
    expect(dailySummaryTime("2026-08-21").toISOString()).toBe("2026-08-21T01:00:00.000Z");
  });

  it("explains why an important reminder was generated", () => {
    expect(reminderReasonText(["high_priority", "fixed_schedule"])).toBe("高优先级任务、固定安排");
    expect(reminderMessage("daily_summary", null, ["blocked_task", "impossible_capacity"]))
      .toContain("阻塞任务、容量不可行");
  });
});
