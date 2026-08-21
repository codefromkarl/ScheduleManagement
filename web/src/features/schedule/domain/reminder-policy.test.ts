import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "../data/demo-snapshot";
import { evaluateDailySummary, evaluateTaskReminder } from "./reminder-policy";

describe("reminder importance policy", () => {
  it("uses automatic importance without turning ordinary work into notification noise", () => {
    expect(evaluateTaskReminder({ kind: "flexible", priority: "normal", reminderPolicy: "auto" }, "start").eligible).toBe(false);
    expect(evaluateTaskReminder({ kind: "flexible", priority: "high", reminderPolicy: "auto" }, "start").reasons).toEqual(["high_priority"]);
    expect(evaluateTaskReminder({ kind: "fixed", priority: "normal", reminderPolicy: "auto" }, "schedule_change").reasons).toEqual(["fixed_schedule"]);
  });

  it("lets per-task overrides force or suppress task reminders", () => {
    expect(evaluateTaskReminder({ kind: "floating", priority: "low", reminderPolicy: "always" }, "start")).toEqual({ eligible: true, reasons: ["task_override"] });
    expect(evaluateTaskReminder({ kind: "fixed", priority: "high", reminderPolicy: "never" }, "schedule_change")).toEqual({ eligible: false, reasons: [] });
  });

  it("creates a daily summary only for real schedule risk", () => {
    const healthy = createDemoSnapshot("2026-08-21");
    healthy.tasks = healthy.tasks.map((task) => ({ ...task, status: "done" }));
    expect(evaluateDailySummary(healthy)).toEqual({ eligible: false, reasons: [] });

    const risky = createDemoSnapshot("2026-08-21");
    risky.tasks = risky.tasks.map((task, index) => ({ ...task, status: index === 0 ? "blocked" : "done", reminderPolicy: "auto" }));
    expect(evaluateDailySummary(risky)).toMatchObject({ eligible: true, reasons: expect.arrayContaining(["blocked_task"]) });
  });
});
