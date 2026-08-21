import { NextResponse } from "next/server";
import { getActiveScheduleStore } from "@/features/schedule/data/active-store";

export async function GET() {
  try {
    return NextResponse.json({ tasks: await getActiveScheduleStore().getUnplannedTasks() });
  } catch {
    return NextResponse.json({ error: { code: "UNPLANNED_READ_FAILED", message: "跨日期待安排暂时不可用" } }, { status: 503 });
  }
}
