import { describe, expect, it } from "vitest";
import { qqTestReminderRequestSchema, qqTestReminderTime } from "./test-reminder";

describe("QQ test reminder scheduling", () => {
  it("defaults to immediate delivery and supports a bounded delay", () => {
    expect(qqTestReminderRequestSchema.parse({})).toEqual({ delayMinutes: 0 });
    expect(qqTestReminderTime(15, new Date("2026-08-21T06:20:00.000Z")).toISOString()).toBe("2026-08-21T06:35:00.000Z");
  });

  it("rejects negative, fractional, and excessive delays", () => {
    expect(qqTestReminderRequestSchema.safeParse({ delayMinutes: -1 }).success).toBe(false);
    expect(qqTestReminderRequestSchema.safeParse({ delayMinutes: 1.5 }).success).toBe(false);
    expect(qqTestReminderRequestSchema.safeParse({ delayMinutes: 61 }).success).toBe(false);
  });
});
