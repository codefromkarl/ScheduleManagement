import { pwaIsConfigured, qqIsConfigured } from "@/server/qq/config";

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

export function reminderMessage(kind: ReminderKind, taskId?: string | null) {
  if (kind === "start") return `提醒：任务即将开始（${taskId ?? "未命名任务"}）`;
  if (kind === "schedule_change") return "提醒：你的日程刚刚发生调整，请打开 goalset 查看受影响的任务。";
  return "今日摘要：请打开 goalset 查看未完成、逾期和阻塞任务。";
}
