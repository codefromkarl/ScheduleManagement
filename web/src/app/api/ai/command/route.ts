import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleDateSchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import { AIConfigurationError, parseScheduleCommand } from "@/server/ai/provider";

const commandSchema = z.object({ message: z.string().min(1).max(2000), date: scheduleDateSchema, optimize: z.boolean().optional().default(false) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "message and date are required" } }, { status: 400 });

  try {
    const store = getActiveScheduleStore();
    const snapshot = await store.getSnapshot(parsed.data.date);
    const plan = await parseScheduleCommand(parsed.data.message, parsed.data.date, snapshot);
    if (plan.needsClarification) return NextResponse.json({ kind: "clarification", reply: plan.clarifyingQuestion ?? plan.reply, plan });

    if (plan.operation === "reschedule_task") {
      if (!plan.targetTaskId || plan.targetStartMinutes === null) return NextResponse.json({ kind: "clarification", reply: plan.clarifyingQuestion ?? "请告诉我需要改期的任务和时间。", plan });
      const targetDate = plan.targetDate ?? parsed.data.date;
      const result = await store.rescheduleTask(plan.targetTaskId, targetDate, plan.targetStartMinutes, { mode: parsed.data.optimize ? "optimize" : "rules", source: parsed.data.optimize ? "ai-reschedule" : "web-reschedule" });
      if (result.proposal.decision === "needs_confirmation") return NextResponse.json({ kind: "reschedule_proposal", reply: plan.reply, plan, taskId: plan.targetTaskId, reschedule: { taskId: plan.targetTaskId, date: targetDate, startMinutes: plan.targetStartMinutes }, proposal: result.proposal, snapshot: result.snapshot }, { status: 409 });
      if (result.proposal.decision !== "auto") return NextResponse.json({ kind: "clarification", reply: result.proposal.reasons.join(" "), plan, proposal: result.proposal, snapshot: result.snapshot }, { status: 422 });
      return NextResponse.json({ kind: "rescheduled", reply: plan.reply, plan, taskId: plan.targetTaskId, reschedule: { taskId: plan.targetTaskId, date: targetDate, startMinutes: plan.targetStartMinutes }, proposal: result.proposal, changeSetId: result.changeSetId, snapshot: result.snapshot }, { status: 200 });
    }

    if (plan.operation === "update_task") {
      if (!plan.targetTaskId || !plan.update) return NextResponse.json({ kind: "clarification", reply: plan.clarifyingQuestion ?? "请告诉我需要更新哪一个任务。", plan });
      const changes = Object.fromEntries(Object.entries(plan.update).filter(([, value]) => value !== null)) as { status?: "todo" | "doing" | "blocked" | "done"; priority?: "low" | "normal" | "high"; notes?: string };
      const updatedSnapshot = await store.updateTask(plan.targetTaskId, changes, { source: "ai", originalCommand: parsed.data.message });
      return NextResponse.json({ kind: "updated", reply: plan.reply, plan, taskId: plan.targetTaskId, snapshot: updatedSnapshot }, { status: 200 });
    }

    if (!plan.task) return NextResponse.json({ kind: "clarification", reply: plan.clarifyingQuestion ?? plan.reply, plan });

    const targetDate = plan.targetDate ?? parsed.data.date;
    const task = {
      id: `ai-${crypto.randomUUID()}`,
      date: targetDate,
      status: "todo" as const,
      movable: plan.task.kind !== "fixed",
      ...plan.task,
      preferredStartMinutes: plan.task.preferredStartMinutes ?? undefined,
      deadlineMinutes: plan.task.deadlineMinutes ?? undefined,
    };
    const result = await store.insertTask(task, { mode: parsed.data.optimize ? "optimize" : "rules", source: parsed.data.optimize ? "ai-optimize" : "ai-command" });
    const kind = result.proposal.decision === "auto" ? "applied" : result.proposal.decision === "no_slot" ? "unplanned" : "proposal";
    return NextResponse.json({ kind, reply: plan.reply, task, plan, proposal: result.proposal, changeSetId: result.changeSetId, snapshot: result.snapshot }, { status: result.proposal.decision === "needs_confirmation" ? 409 : 201 });
  } catch (error) {
    if (error instanceof AIConfigurationError) return NextResponse.json({ error: { code: "AI_NOT_CONFIGURED", message: error.message } }, { status: 503 });
    return NextResponse.json({ error: { code: "AI_REQUEST_FAILED", message: "AI 暂时不可用，原日程没有改变" } }, { status: 502 });
  }
}
