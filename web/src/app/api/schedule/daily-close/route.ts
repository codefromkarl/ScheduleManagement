import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleDateSchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";

const requestSchema = z.object({ date: scheduleDateSchema, action: z.enum(["unplan", "move_tomorrow"]) });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "收尾参数无效" } }, { status: 400 });
  try {
    return NextResponse.json(await getActiveScheduleStore().closeDay(parsed.data.date, parsed.data.action));
  } catch {
    return NextResponse.json({ error: { code: "DAILY_CLOSE_FAILED", message: "今日收尾失败，原日程没有改变" } }, { status: 409 });
  }
}
