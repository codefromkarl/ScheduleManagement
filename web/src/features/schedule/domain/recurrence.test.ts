import { describe, expect, it } from "vitest";
import { applyOccurrenceOverrides, generateOccurrenceDates } from "./recurrence";

describe("generateOccurrenceDates", () => {
  it("generates workdays within a range", () => {
    expect(generateOccurrenceDates({ frequency: "workday", startDate: "2026-08-17" }, "2026-08-17", "2026-08-23")).toEqual(["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"]);
  });

  it("supports selected weekdays and end dates", () => {
    expect(generateOccurrenceDates({ frequency: "weekdays", weekdays: [2, 4], startDate: "2026-08-17", endDate: "2026-08-31" }, "2026-08-17", "2026-09-01")).toEqual(["2026-08-18", "2026-08-20", "2026-08-25", "2026-08-27"]);
  });

  it("rejects impossible date ranges", () => {
    expect(() => generateOccurrenceDates({ frequency: "daily", startDate: "2026-08-20" }, "2026-08-21", "2026-08-20")).toThrow("INVALID_RANGE");
  });

  it("skips one occurrence without changing the parent dates", () => {
    const dates = generateOccurrenceDates({ frequency: "daily", startDate: "2026-08-20" }, "2026-08-20", "2026-08-22");
    expect(applyOccurrenceOverrides(dates, [{ occurrenceDate: "2026-08-21", action: "skip" }]).map((item) => item.date)).toEqual(["2026-08-20", "2026-08-22"]);
    expect(dates).toEqual(["2026-08-20", "2026-08-21", "2026-08-22"]);
  });

  it("keeps calendar dates stable across a daylight-saving transition", () => {
    expect(generateOccurrenceDates({ frequency: "daily", startDate: "2026-03-07" }, "2026-03-07", "2026-03-10")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
  });

  it("includes leap day without shifting the following occurrence", () => {
    expect(generateOccurrenceDates({ frequency: "daily", startDate: "2028-02-28" }, "2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
});
