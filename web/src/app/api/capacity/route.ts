import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleDateSchema } from "@/features/schedule/data/contract";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";
import { calculateDailyCapacity } from "@/features/schedule/domain/capacity";

const querySchema = z.object({ from: scheduleDateSchema, to: scheduleDateSchema }).superRefine((value, context) => {
  const days = Math.round((Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < 1 || days > 31) context.addIssue({ code: "custom", message: "capacity range must contain 1 to 31 days" });
});

function dateKeys(from: string, to: string) {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) { result.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return result;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "容量日期范围无效" } }, { status: 400 });
  try {
    const store = getActiveScheduleStore();
    const days = await Promise.all(dateKeys(parsed.data.from, parsed.data.to).map(async (date) => calculateDailyCapacity(await store.getSnapshot(date))));
    return NextResponse.json({ days, totals: { unfinishedMinutes: days.reduce((total, day) => total + day.unfinishedMinutes, 0), unplannedMinutes: days.reduce((total, day) => total + day.unplannedMinutes, 0), safeFreeMinutes: days.reduce((total, day) => total + day.safeFreeMinutes, 0), deficitMinutes: days.reduce((total, day) => total + day.deficitMinutes, 0) } });
  } catch {
    return NextResponse.json({ error: { code: "CAPACITY_READ_FAILED", message: "容量预测暂时不可用" } }, { status: 503 });
  }
}
