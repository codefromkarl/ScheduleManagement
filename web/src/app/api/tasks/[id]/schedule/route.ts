import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleDateSchema, scheduleMinutesSchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";

const requestSchema = z.object({
  date: scheduleDateSchema,
  startMinutes: scheduleMinutesSchema.optional(),
  mode: z.enum(["rules", "optimize"]).default("rules"),
  confirm: z.boolean().optional().default(false),
}).superRefine((value, context) => {
  if (value.mode === "rules" && value.startMinutes === undefined) {
    context.addIssue({ code: "custom", path: ["startMinutes"], message: "规则布置需要明确开始时间" });
  }
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "布置参数无效" } }, { status: 400 });

  try {
    const result = await getActiveScheduleStore().scheduleTask(id, parsed.data.date, {
      startMinutes: parsed.data.startMinutes,
      mode: parsed.data.mode,
      confirm: parsed.data.confirm,
      source: parsed.data.mode === "optimize" ? "ai-optimize" : "web-place",
    });
    if (result.proposal.decision === "needs_confirmation") return NextResponse.json(result, { status: 409 });
    if (result.proposal.decision !== "auto") return NextResponse.json(result, { status: 422 });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_NOT_FOUND") return NextResponse.json({ error: { code: "TASK_NOT_FOUND", message: "任务不存在" } }, { status: 404 });
    return NextResponse.json({ error: { code: "SCHEDULE_TASK_FAILED", message: "任务布置失败，原日程没有改变" } }, { status: 409 });
  }
}
