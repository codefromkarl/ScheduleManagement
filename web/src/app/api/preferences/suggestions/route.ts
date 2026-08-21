import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { tasks } from "@/server/db/schema";

export async function GET() {
  const rows = await getDb().select({ estimatedMinutes: tasks.estimatedMinutes }).from(tasks).where(and(eq(tasks.workspaceId, "personal"), ne(tasks.source, "seed")));
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.estimatedMinutes, (counts.get(row.estimatedMinutes) ?? 0) + 1);
  const [value, sampleCount] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0] ?? [];
  if (!value || !sampleCount || sampleCount < 3) return NextResponse.json({ suggestion: null });
  return NextResponse.json({ suggestion: { value, sampleCount, message: `你最近有 ${sampleCount} 个已接受任务使用了 ${value} 分钟，可以将它设为默认时长。` } });
}
