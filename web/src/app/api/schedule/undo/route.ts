import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";

const schema = z.object({ changeSetId: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "changeSetId is required" } }, { status: 400 });
  try {
    return NextResponse.json({ snapshot: await getActiveScheduleStore().undoChangeSet(parsed.data.changeSetId) });
  } catch (error) {
    if (error instanceof Error && error.message === "CHANGE_SET_NOT_FOUND") return NextResponse.json({ error: { code: "CHANGE_SET_NOT_FOUND", message: "变更不存在或已经撤销" } }, { status: 404 });
    return NextResponse.json({ error: { code: "UNDO_FAILED", message: "撤销失败，当前日程未改变" } }, { status: 409 });
  }
}
