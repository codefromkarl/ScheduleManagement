import { describe, expect, it } from "vitest";
import { findScheduleProposal, placementToBlock } from "./scheduler";
import type { ScheduleContext, ScheduleTask } from "./types";

const date = "2026-08-20";

function task(overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: "new-task",
    title: "临时任务",
    date,
    kind: "flexible",
    priority: "normal",
    status: "todo",
    reminderPolicy: "auto",
    estimatedMinutes: 60,
    movable: true,
    ...overrides,
  };
}

function context(overrides: Partial<ScheduleContext> = {}): ScheduleContext {
  return {
    date,
    availability: [{ date, startMinutes: 9 * 60, endMinutes: 18 * 60 }],
    unavailable: [],
    existing: [],
    bufferMinutes: 15,
    ...overrides,
  };
}

describe("findScheduleProposal", () => {
  it("finds the earliest usable slot while respecting a fixed block and buffer", () => {
    const proposal = findScheduleProposal(task(), context({
      existing: [{ id: "fixed-1", taskId: "fixed", date, startMinutes: 10 * 60, durationMinutes: 60, kind: "fixed", movable: false, title: "会议" }],
    }));

    expect(proposal.decision).toBe("auto");
    expect(proposal.placement).toEqual({ date, startMinutes: 11 * 60 + 15, endMinutes: 12 * 60 + 15 });
  });

  it("does not move a fixed block when an exact fixed task conflicts", () => {
    const proposal = findScheduleProposal(task({ kind: "fixed", movable: false, preferredStartMinutes: 10 * 60 }), context({
      existing: [{ id: "fixed-1", taskId: "fixed", date, startMinutes: 10 * 60, durationMinutes: 60, kind: "fixed", movable: false, title: "会议" }],
    }));

    expect(proposal.decision).toBe("no_slot");
    expect(proposal.movedBlockIds).toEqual([]);
  });

  it("returns a confirmation proposal when a movable task must be shifted", () => {
    const proposal = findScheduleProposal(task({ preferredStartMinutes: 10 * 60, deadlineMinutes: 11 * 60 }), context({
      availability: [{ date, startMinutes: 10 * 60, endMinutes: 12 * 60 }],
      existing: [{ id: "elastic-1", taskId: "old", date, startMinutes: 10 * 60, durationMinutes: 60, kind: "flexible", movable: true, title: "弹性任务" }],
      bufferMinutes: 0,
      mode: "optimize",
    }));

    expect(proposal.decision).toBe("needs_confirmation");
    expect(proposal.movedBlockIds).toEqual(["elastic-1"]);
    expect(proposal.placement?.startMinutes).toBe(10 * 60);
    expect(proposal.moves).toEqual([{ blockId: "elastic-1", fromStartMinutes: 10 * 60, toStartMinutes: 11 * 60, durationMinutes: 60 }]);
  });

  it("keeps an exact reschedule target instead of falling into another free slot", () => {
    const proposal = findScheduleProposal(task({ exactStartMinutes: 10 * 60, estimatedMinutes: 60, deadlineMinutes: 11 * 60 }), context({
      availability: [{ date, startMinutes: 10 * 60, endMinutes: 13 * 60 }],
      existing: [{ id: "elastic-1", taskId: "old", date, startMinutes: 10 * 60, durationMinutes: 60, kind: "flexible", movable: true, title: "弹性任务" }],
      bufferMinutes: 0,
      mode: "optimize",
    }));

    expect(proposal.decision).toBe("needs_confirmation");
    expect(proposal.placement?.startMinutes).toBe(10 * 60);
    expect(proposal.moves[0]?.toStartMinutes).toBe(11 * 60);
  });

  it("groups work near an existing block from the same project", () => {
    const proposal = findScheduleProposal(task({ id: "same-project", projectId: "project-a", estimatedMinutes: 60 }), context({
      existing: [{ id: "project-block", taskId: "existing", date, startMinutes: 12 * 60, durationMinutes: 60, kind: "flexible", movable: true, title: "同项目任务", projectId: "project-a", priority: "normal" }],
      bufferMinutes: 0,
      mode: "optimize",
    }));

    expect(proposal.decision).toBe("auto");
    expect(proposal.placement?.startMinutes).toBe(11 * 60);
  });

  it("keeps chronological ordering when there is no matching project context", () => {
    const proposal = findScheduleProposal(task({ id: "other-project", projectId: "project-b", estimatedMinutes: 60 }), context({
      existing: [{ id: "project-block", taskId: "existing", date, startMinutes: 12 * 60, durationMinutes: 60, kind: "flexible", movable: true, title: "其他项目", projectId: "project-a", priority: "normal" }],
      bufferMinutes: 0,
    }));

    expect(proposal.decision).toBe("auto");
    expect(proposal.placement?.startMinutes).toBe(9 * 60);
  });

  it("creates a relocation plan after preserving a fixed block", () => {
    const proposal = findScheduleProposal(task({ preferredStartMinutes: 10 * 60, deadlineMinutes: 12 * 60 }), context({
      existing: [
        { id: "fixed-1", taskId: "fixed", date, startMinutes: 9 * 60, durationMinutes: 60, kind: "fixed", movable: false, title: "固定" },
        { id: "elastic-1", taskId: "elastic", date, startMinutes: 10 * 60 + 30, durationMinutes: 90, kind: "flexible", movable: true, title: "弹性" },
      ],
      bufferMinutes: 15,
      mode: "optimize",
    }));

    expect(proposal.decision).toBe("needs_confirmation");
    expect(proposal.moves[0]?.blockId).toBe("elastic-1");
    expect(proposal.moves[0]?.toStartMinutes).toBeGreaterThan(10 * 60 + 30);
  });

  it("rejects a candidate that cannot meet its hard deadline", () => {
    const proposal = findScheduleProposal(task({ estimatedMinutes: 90, deadlineMinutes: 10 * 60 }), context());

    expect(proposal.decision).toBe("no_slot");
  });

  it("keeps normal placement predictable and never moves an existing elastic task", () => {
    const proposal = findScheduleProposal(task({ preferredStartMinutes: 10 * 60, deadlineMinutes: 11 * 60 }), context({
      availability: [{ date, startMinutes: 10 * 60, endMinutes: 12 * 60 }],
      existing: [{ id: "elastic-1", taskId: "old", date, startMinutes: 10 * 60, durationMinutes: 60, kind: "flexible", movable: true, title: "弹性任务" }],
      bufferMinutes: 0,
    }));

    expect(proposal.decision).toBe("no_slot");
    expect(proposal.moves).toEqual([]);
  });

  it("uses the closest preferred safe slot in normal rules mode", () => {
    const proposal = findScheduleProposal(task({ preferredStartMinutes: 13 * 60, estimatedMinutes: 60 }), context({
      existing: [{ id: "fixed-1", taskId: "fixed", date, startMinutes: 13 * 60, durationMinutes: 60, kind: "fixed", movable: false, title: "会议" }],
      bufferMinutes: 0,
    }));

    expect(proposal.decision).toBe("auto");
    expect(proposal.placement?.startMinutes).toBe(12 * 60);
  });

  it("ignores priority and project scoring in normal rules mode", () => {
    const proposal = findScheduleProposal(task({ priority: "high", projectId: "project-a" }), context({
      existing: [{ id: "project-block", taskId: "existing", date, startMinutes: 12 * 60, durationMinutes: 60, kind: "flexible", movable: true, title: "同项目任务", projectId: "project-a" }],
      bufferMinutes: 0,
    }));

    expect(proposal.placement?.startMinutes).toBe(9 * 60);
  });

  it("skips unavailable time windows", () => {
    const proposal = findScheduleProposal(task(), context({
      unavailable: [{ date, startMinutes: 9 * 60, endMinutes: 12 * 60, reason: "外出" }],
    }));

    expect(proposal.decision).toBe("auto");
    expect(proposal.placement?.startMinutes).toBe(12 * 60 + 15);
  });

  it("keeps the configured buffer away from unavailable windows", () => {
    const proposal = findScheduleProposal(task({ id: "buffered", estimatedMinutes: 15 }), {
      ...context(),
      availability: [{ date, startMinutes: 9 * 60, endMinutes: 18 * 60 }],
      unavailable: [{ date, startMinutes: 12 * 60, endMinutes: 13 * 60, reason: "午休" }],
      existing: [],
      bufferMinutes: 15,
    });
    expect(proposal.placement?.startMinutes).toBe(9 * 60);
    expect(proposal.placement?.endMinutes).toBe(9 * 60 + 15);
  });

  it("rejects non-15-minute durations before planning", () => {
    expect(() => findScheduleProposal(task({ estimatedMinutes: 20 }), context())).toThrow("15-minute");
  });

  it("creates a stable block identity from a chosen placement", () => {
    const block = placementToBlock(task({ id: "write" }), { date, startMinutes: 13 * 60, endMinutes: 14 * 60 });

    expect(block.id).toBe("write:2026-08-20:780");
    expect(block.durationMinutes).toBe(60);
  });
});
