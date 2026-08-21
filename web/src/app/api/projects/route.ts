import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { projects, scheduleBlocks, tasks, workspaces } from "@/server/db/schema";

const projectSchema = z.object({ name: z.string().min(1).max(100), tone: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });

export async function GET() {
  const db = getDb();
  const rows = await db.select({ projectId: projects.id, name: projects.name, tone: projects.tone, archived: projects.archived, taskId: tasks.id, taskDate: tasks.date, taskStatus: tasks.status, estimatedMinutes: tasks.estimatedMinutes, deadlineMinutes: tasks.deadlineMinutes, blockId: scheduleBlocks.id, blockStartMinutes: scheduleBlocks.startMinutes, blockDurationMinutes: scheduleBlocks.durationMinutes }).from(projects).leftJoin(tasks, eq(tasks.projectId, projects.id)).leftJoin(scheduleBlocks, and(eq(scheduleBlocks.taskId, tasks.id), eq(scheduleBlocks.date, tasks.date))).where(eq(projects.workspaceId, "personal"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const grouped = new Map<string, { id: string; name: string; tone: string; archived: boolean; count: number; totalMinutes: number; doneMinutes: number; blockedCount: number; overdueCount: number; unplannedCount: number; deadlineRiskCount: number; taskIds: Set<string> }>();
  for (const row of rows) {
    const current = grouped.get(row.projectId) ?? { id: row.projectId, name: row.name, tone: row.tone, archived: row.archived, count: 0, totalMinutes: 0, doneMinutes: 0, blockedCount: 0, overdueCount: 0, unplannedCount: 0, deadlineRiskCount: 0, taskIds: new Set<string>() };
    if (row.taskId && !current.taskIds.has(row.taskId)) {
      current.taskIds.add(row.taskId);
      current.count += 1;
      current.totalMinutes += row.estimatedMinutes ?? 0;
      if (row.taskStatus === "done") current.doneMinutes += row.estimatedMinutes ?? 0;
      if (row.taskStatus === "blocked") current.blockedCount += 1;
      if (row.taskStatus !== "done" && row.taskDate && row.taskDate < today) current.overdueCount += 1;
      if (row.taskStatus !== "done" && !row.blockId) current.unplannedCount += 1;
      if (row.taskStatus !== "done" && row.deadlineMinutes !== null && (!row.blockId || row.blockStartMinutes === null || row.blockDurationMinutes === null || row.blockStartMinutes + row.blockDurationMinutes > row.deadlineMinutes)) current.deadlineRiskCount += 1;
    }
    grouped.set(row.projectId, current);
  }
  return NextResponse.json({ projects: [...grouped.values()].map((row) => {
    const progress = row.totalMinutes ? Math.round((row.doneMinutes / row.totalMinutes) * 100) : 0;
    const health = row.blockedCount > 0 ? "blocked" : row.overdueCount > 0 || row.unplannedCount > 0 || row.deadlineRiskCount > 0 ? "at_risk" : row.count === 0 ? "empty" : "healthy";
    const healthReason = health === "blocked" ? `${row.blockedCount} 项任务阻塞` : health === "at_risk" ? `${row.overdueCount} 项逾期 · ${row.unplannedCount} 项未排期 · ${row.deadlineRiskCount} 项截止风险` : health === "empty" ? "还没有任务" : "按当前计划推进";
    const summary = { id: row.id, name: row.name, tone: row.tone, archived: row.archived, count: row.count, totalMinutes: row.totalMinutes, doneMinutes: row.doneMinutes, blockedCount: row.blockedCount, overdueCount: row.overdueCount, unplannedCount: row.unplannedCount, deadlineRiskCount: row.deadlineRiskCount };
    return { ...summary, progress, remainingMinutes: Math.max(0, row.totalMinutes - row.doneMinutes), health, healthReason };
  }) });
}

export async function POST(request: Request) {
  const parsed = projectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "项目名称无效" } }, { status: 400 });
  const db = getDb();
  await db.insert(workspaces).values({ id: "personal", name: "个人工作区", timezone: "Asia/Shanghai" }).onConflictDoNothing();
  const id = crypto.randomUUID();
  try {
    const [project] = await db.insert(projects).values({ id, workspaceId: "personal", name: parsed.data.name, tone: parsed.data.tone ?? "#8a76d8" }).returning();
    return NextResponse.json({ project }, { status: 201 });
  } catch {
    return NextResponse.json({ error: { code: "PROJECT_EXISTS", message: "项目名称已存在" } }, { status: 409 });
  }
}
