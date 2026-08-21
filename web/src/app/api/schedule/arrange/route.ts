import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleDateSchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";

const requestSchema = z.object({ date: scheduleDateSchema });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "批量排程日期无效" } }, { status: 400 });
  try {
    return NextResponse.json(await getActiveScheduleStore().arrangeUnplanned(parsed.data.date));
  } catch {
    return NextResponse.json({ error: { code: "ARRANGE_FAILED", message: "批量排程失败，原日程没有改变" } }, { status: 409 });
  }
}
