import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "@/features/schedule/data/demo-snapshot";
import { parseScheduleCommand } from "./provider";

describe("AI schedule provider", () => {
  it("returns a validated structured plan in local mock mode", async () => {
    const previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const plan = await parseScheduleCommand("整理临时会议材料", "2026-08-21", createDemoSnapshot("2026-08-21"));
      expect(plan.needsClarification).toBe(false);
      expect(plan.task?.title).toBe("整理临时会议材料");
      expect(plan.task?.estimatedMinutes).toBe(30);
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previous;
    }
  });

  it("asks for duration in local rule mode when the command is incomplete", async () => {
    const previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "local";
    try {
      const plan = await parseScheduleCommand("下午安排整理会议材料", "2026-08-21", createDemoSnapshot("2026-08-21"));
      expect(plan.needsClarification).toBe(true);
      expect(plan.clarifyingQuestion).toContain("多长时间");
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previous;
    }
  });

  it("recognizes a local status update against an existing task", async () => {
    const previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "local";
    try {
      const snapshot = createDemoSnapshot("2026-08-21");
      const plan = await parseScheduleCommand("把梳理产品路线标记为完成", "2026-08-21", snapshot);
      expect(plan.operation).toBe("update_task");
      expect(plan.targetTaskId).toBe("roadmap");
      expect(plan.update?.status).toBe("done");
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previous;
    }
  });

  it("uses an explicit default duration instead of guessing silently", async () => {
    const previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "local";
    try {
      const snapshot = { ...createDemoSnapshot("2026-08-21"), defaultDurationMinutes: 45 };
      const plan = await parseScheduleCommand("整理会议材料", "2026-08-21", snapshot);
      expect(plan.needsClarification).toBe(false);
      expect(plan.task?.estimatedMinutes).toBe(45);
      expect(plan.reply).toContain("默认时长");
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previous;
    }
  });

  it("resolves relative dates in the local command envelope", async () => {
    const previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "local";
    try {
      const plan = await parseScheduleCommand("明天整理会议材料 30 分钟", "2026-08-21", createDemoSnapshot("2026-08-21"));
      expect(plan.targetDate).toBe("2026-08-22");
      expect(plan.task?.estimatedMinutes).toBe(30);
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previous;
    }
  });

  it("recognizes an exact reschedule request", async () => {
    const previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "local";
    try {
      const plan = await parseScheduleCommand("把梳理产品路线改到下午 15:00", "2026-08-21", createDemoSnapshot("2026-08-21"));
      expect(plan.operation).toBe("reschedule_task");
      expect(plan.targetTaskId).toBe("roadmap");
      expect(plan.targetStartMinutes).toBe(900);
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previous;
    }
  });
});
