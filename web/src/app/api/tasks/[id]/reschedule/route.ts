import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleDateSchema, scheduleMinutesSchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";

const requestSchema = z.object({ date: scheduleDateSchema, startMinutes: scheduleMinutesSchema, confirm: z.boolean().optional().default(false), optimize: z.boolean().optional().default(false) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "改期参数无效" } }, { status: 400 });
  try {
    const result = await getActiveScheduleStore().rescheduleTask(id, parsed.data.date, parsed.data.startMinutes, { confirm: parsed.data.confirm, mode: parsed.data.optimize ? "optimize" : "rules", source: parsed.data.optimize ? "ai-reschedule" : "web-reschedule" });
    if (result.proposal.decision === "needs_confirmation") return NextResponse.json(result, { status: 409 });
    if (result.proposal.decision !== "auto") return NextResponse.json(result, { status: 422 });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_NOT_FOUND") return NextResponse.json({ error: { code: "TASK_NOT_FOUND", message: "任务不存在" } }, { status: 404 });
    return NextResponse.json({ error: { code: "RESCHEDULE_FAILED", message: "改期失败，原日程没有改变" } }, { status: 409 });
  }
}
