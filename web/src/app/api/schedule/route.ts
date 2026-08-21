import { NextResponse } from "next/server";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import { scheduleCommandSchema, scheduleDateSchema } from "@/features/schedule/data/contract";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { code: "INVALID_REQUEST", message } }, { status });
}

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  const parsedDate = scheduleDateSchema.safeParse(date);
  if (!parsedDate.success) return errorResponse("date must use YYYY-MM-DD", 400);
  return NextResponse.json(await getActiveScheduleStore().getSnapshot(parsedDate.data));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = scheduleCommandSchema.safeParse(body);
  if (!parsed.success) return errorResponse("task payload is invalid", 400);

  const result = await getActiveScheduleStore().insertTask(parsed.data.task);
  if (result.proposal.decision === "needs_confirmation") {
    return NextResponse.json(result, { status: 409 });
  }
  if (result.proposal.decision === "needs_information") {
    return NextResponse.json(result, { status: 422 });
  }
  return NextResponse.json(result, { status: 201 });
}
