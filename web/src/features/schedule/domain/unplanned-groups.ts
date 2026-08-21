import type { ScheduleTask } from "./types";
import { rankUnplannedTasks } from "./unplanned";

export type UnplannedGroupKey = "overdue" | "today" | "tomorrow" | "week" | "later";
export type UnplannedGroup = { key: UnplannedGroupKey; label: string; tasks: ScheduleTask[] };

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function groupUnplannedTasks(tasks: ScheduleTask[], today: string): UnplannedGroup[] {
  const tomorrow = addDays(today, 1);
  const todayValue = new Date(`${today}T00:00:00Z`);
  const daysToSunday = (7 - todayValue.getUTCDay()) % 7;
  const weekEnd = addDays(today, daysToSunday);
  const grouped = new Map<UnplannedGroupKey, ScheduleTask[]>([["overdue", []], ["today", []], ["tomorrow", []], ["week", []], ["later", []]]);
  for (const task of rankUnplannedTasks(tasks)) {
    const key: UnplannedGroupKey = task.date < today ? "overdue" : task.date === today ? "today" : task.date === tomorrow ? "tomorrow" : task.date <= weekEnd ? "week" : "later";
    grouped.get(key)!.push(task);
  }
  const labels: Record<UnplannedGroupKey, string> = { overdue: "已逾期", today: "今天", tomorrow: "明天", week: "本周", later: "以后" };
  return (["overdue", "today", "tomorrow", "week", "later"] as const).map((key) => ({ key, label: labels[key], tasks: grouped.get(key)! })).filter((group) => group.tasks.length > 0);
}
