import { NextResponse } from "next/server";
import { scheduleCommandSchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = scheduleCommandSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "task payload is invalid" } }, { status: 400 });
  const result = await getActiveScheduleStore().confirmTask(parsed.data.task, { mode: "optimize", source: "web-confirmed" });
  if (result.proposal.decision !== "auto") return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result, { status: 201 });
}
