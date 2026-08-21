import { NextResponse } from "next/server";
import { dateKeysInRange, scheduleRangeQuerySchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import { calculateDailyCapacity } from "@/features/schedule/domain/capacity";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = scheduleRangeQuerySchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Dashboard 日期范围无效" } }, { status: 400 });
  }

  try {
    const store = getActiveScheduleStore();
    const snapshots = await store.getSnapshots(dateKeysInRange(parsed.data.from, parsed.data.to));
    const unplannedTasks = await store.getUnplannedTasks();
    return NextResponse.json({ snapshots, capacityDays: snapshots.map(calculateDailyCapacity), unplannedTasks });
  } catch {
    return NextResponse.json({ error: { code: "DASHBOARD_READ_FAILED", message: "日程总览暂时不可用" } }, { status: 503 });
  }
}
