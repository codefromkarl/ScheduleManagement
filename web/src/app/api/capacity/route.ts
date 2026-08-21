import { NextResponse } from "next/server";
import { dateKeysInRange, scheduleRangeQuerySchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import { calculateDailyCapacity } from "@/features/schedule/domain/capacity";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = scheduleRangeQuerySchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "容量日期范围无效" } }, { status: 400 });
  try {
    const store = getActiveScheduleStore();
    const snapshots = await store.getSnapshots(dateKeysInRange(parsed.data.from, parsed.data.to));
    const days = snapshots.map(calculateDailyCapacity);
    return NextResponse.json({ days, totals: { unfinishedMinutes: days.reduce((total, day) => total + day.unfinishedMinutes, 0), unplannedMinutes: days.reduce((total, day) => total + day.unplannedMinutes, 0), safeFreeMinutes: days.reduce((total, day) => total + day.safeFreeMinutes, 0), deficitMinutes: days.reduce((total, day) => total + day.deficitMinutes, 0) } });
  } catch {
    return NextResponse.json({ error: { code: "CAPACITY_READ_FAILED", message: "容量预测暂时不可用" } }, { status: 503 });
  }
}
