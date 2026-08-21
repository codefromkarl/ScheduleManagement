import { pwaIsConfigured, qqIsConfigured } from "@/server/qq/config";
import type { ReminderImportanceReason } from "@/features/schedule/domain/reminder-policy";

export const REMINDER_WORKSPACE_ID = "personal";
export type ReminderChannel = "qq" | "pwa";
export type ReminderKind = "start" | "schedule_change" | "daily_summary";

export function configuredReminderChannels(): ReminderChannel[] {
  return [
    ...(qqIsConfigured() ? ["qq" as const] : []),
    ...(pwaIsConfigured() ? ["pwa" as const] : []),
  ];
}

export function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function dailySummaryTime(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 1, 0));
}

const importanceLabels: Record<ReminderImportanceReason, string> = {
  task_override: "单任务强制提醒",
  high_priority: "高优先级任务",
  fixed_schedule: "固定安排",
  blocked_task: "阻塞任务",
  deadline_risk: "截止风险",
  impossible_capacity: "容量不可行",
  unhandled_high_priority: "高优先级任务待处理",
};

export function reminderReasonText(reasons: ReminderImportanceReason[]) {
  return reasons.map((reason) => importanceLabels[reason]).join("、");
}

export function reminderMessage(kind: ReminderKind, taskId?: string | null, reasons: ReminderImportanceReason[] = []) {
  const reason = reminderReasonText(reasons);
  if (kind === "start") return `重要提醒：任务即将开始（${taskId ?? "未命名任务"}）${reason ? ` · ${reason}` : ""}`;
  if (kind === "schedule_change") return `重要提醒：你的日程刚刚发生调整${reason ? `（${reason}）` : ""}，请打开 goalset 查看受影响的任务。`;
  return `今日风险摘要${reason ? `：${reason}` : ""}。请打开 goalset 查看并处理。`;
}
