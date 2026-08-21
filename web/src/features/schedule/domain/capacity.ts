import type { ScheduleSnapshot } from "../data/types";

export type CapacityStatus = "healthy" | "tight" | "impossible" | "unknown";

export type DailyCapacity = {
  date: string;
  status: CapacityStatus;
  unfinishedMinutes: number;
  scheduledMinutes: number;
  unplannedMinutes: number;
  safeFreeMinutes: number;
  slackMinutes: number;
  deficitMinutes: number;
  deadlineRiskCount: number;
  reason: string;
};

export function calculateDailyCapacity(snapshot: ScheduleSnapshot): DailyCapacity {
  const unfinished = snapshot.tasks.filter((task) => task.status !== "done");
  const unfinishedIds = new Set(unfinished.map((task) => task.id));
  const blockByTask = new Map(snapshot.blocks.filter((block) => unfinishedIds.has(block.taskId)).map((block) => [block.taskId, block]));
  const scheduledMinutes = [...blockByTask.values()].reduce((total, block) => total + block.durationMinutes, 0);
  const unplannedMinutes = unfinished.filter((task) => !blockByTask.has(task.id)).reduce((total, task) => total + task.estimatedMinutes, 0);
  const unfinishedMinutes = unfinished.reduce((total, task) => total + task.estimatedMinutes, 0);
  const slots = new Set<number>();
  for (const window of snapshot.availability) for (let minute = window.startMinutes; minute < window.endMinutes; minute += 15) slots.add(minute);
  for (const window of snapshot.unavailable) for (let minute = window.startMinutes; minute < window.endMinutes; minute += 15) slots.delete(minute);
  for (const block of snapshot.blocks) {
    const start = Math.max(0, block.startMinutes - snapshot.bufferMinutes);
    const end = Math.min(24 * 60, block.startMinutes + block.durationMinutes + snapshot.bufferMinutes);
    for (let minute = start; minute < end; minute += 15) slots.delete(minute);
  }
  const safeFreeMinutes = slots.size * 15;
  const slackMinutes = safeFreeMinutes - unplannedMinutes;
  const deficitMinutes = Math.max(0, -slackMinutes);
  const deadlineRiskCount = unfinished.filter((task) => task.deadlineMinutes !== undefined && (!blockByTask.has(task.id) || blockByTask.get(task.id)!.startMinutes + blockByTask.get(task.id)!.durationMinutes > task.deadlineMinutes)).length;
  if (snapshot.availability.length === 0) return { date: snapshot.date, status: "unknown", unfinishedMinutes, scheduledMinutes, unplannedMinutes, safeFreeMinutes, slackMinutes, deficitMinutes, deadlineRiskCount, reason: "当天没有可用时间配置，无法判断容量。" };
  if (deficitMinutes > 0 || deadlineRiskCount > 0) return { date: snapshot.date, status: "impossible", unfinishedMinutes, scheduledMinutes, unplannedMinutes, safeFreeMinutes, slackMinutes, deficitMinutes, deadlineRiskCount, reason: deficitMinutes > 0 ? `缺少 ${deficitMinutes} 分钟安全空档。` : `${deadlineRiskCount} 项任务存在截止风险。` };
  if (unfinishedMinutes > 0 && slackMinutes <= Math.max(60, snapshot.bufferMinutes * 2)) return { date: snapshot.date, status: "tight", unfinishedMinutes, scheduledMinutes, unplannedMinutes, safeFreeMinutes, slackMinutes, deficitMinutes, deadlineRiskCount, reason: `仅剩 ${slackMinutes} 分钟容量余量。` };
  return { date: snapshot.date, status: "healthy", unfinishedMinutes, scheduledMinutes, unplannedMinutes, safeFreeMinutes, slackMinutes, deficitMinutes, deadlineRiskCount, reason: `剩余 ${slackMinutes} 分钟安全容量。` };
}
