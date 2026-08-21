import { describe, expect, it } from "vitest";
import type { QqScheduleProposalPreview } from "./schedule-proposal-types";
import { qqProposalSvg, renderQqProposalPng, shouldRenderQqProposalImage } from "./schedule-proposal-image";

const base: QqScheduleProposalPreview = { decision: "auto", taskTitle: "准备周报", date: "2026-08-22", durationMinutes: 60, placement: { date: "2026-08-22", startMinutes: 14 * 60, endMinutes: 15 * 60 }, moves: [], contextBlocks: [], crossDate: false, occupiedNoSlot: false, reasons: [], baseFingerprint: "fingerprint" };

describe("QQ proposal image", () => {
  it("renders only complex time relationships and escapes private text", async () => {
    expect(shouldRenderQqProposalImage(base)).toBe(false);
    const complex = { ...base, taskTitle: "方案 <A>", crossDate: true, contextBlocks: [{ id: "fixed", title: "评审 & 决策", startMinutes: 16 * 60, durationMinutes: 60, kind: "fixed" as const }] };
    expect(shouldRenderQqProposalImage(complex)).toBe(true);
    const svg = qqProposalSvg(complex);
    expect(svg).toContain("方案 &lt;A&gt;");
    expect(svg).toContain("评审 &amp; 决策");
    const png = await renderQqProposalPng(complex);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("uses an occupied no-slot context but skips save-unplanned-only previews", () => {
    expect(shouldRenderQqProposalImage({ ...base, decision: "no_slot", placement: undefined, occupiedNoSlot: true })).toBe(true);
    expect(shouldRenderQqProposalImage({ ...base, decision: "no_slot", placement: undefined })).toBe(false);
  });
});
