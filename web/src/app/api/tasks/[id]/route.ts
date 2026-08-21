import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import { reminderPolicySchema } from "@/features/schedule/data/contract";

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  reminderPolicy: reminderPolicySchema.optional(),
  notes: z.string().max(2000).optional(),
}).refine((value) => Object.keys(value).length > 0, "at least one update is required");

function notFound() {
  return NextResponse.json({ error: { code: "TASK_NOT_FOUND", message: "任务不存在" } }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "任务修改内容无效" } }, { status: 400 });
  try {
    return NextResponse.json({ snapshot: await getActiveScheduleStore().updateTask(id, parsed.data, { source: "web", originalCommand: "manual task update" }) });
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_NOT_FOUND") return notFound();
    return NextResponse.json({ error: { code: "TASK_UPDATE_FAILED", message: "任务更新失败" } }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ snapshot: await getActiveScheduleStore().deleteTask(id) });
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_NOT_FOUND") return notFound();
    return NextResponse.json({ error: { code: "TASK_DELETE_FAILED", message: "任务删除失败" } }, { status: 500 });
  }
}
