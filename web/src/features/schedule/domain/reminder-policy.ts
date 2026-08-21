import type { ScheduleSnapshot } from "../data/types";
import { calculateDailyCapacity } from "./capacity";
import type { ScheduleTask } from "./types";

export type TaskReminderEvent = "start" | "schedule_change";
export const REMINDER_IMPORTANCE_REASONS = [
  "task_override",
  "high_priority",
  "fixed_schedule",
  "blocked_task",
  "deadline_risk",
  "impossible_capacity",
  "unhandled_high_priority",
] as const;
export type ReminderImportanceReason = typeof REMINDER_IMPORTANCE_REASONS[number];

export type ReminderDecision = {
  eligible: boolean;
  reasons: ReminderImportanceReason[];
};

type ReminderTask = Pick<ScheduleTask, "kind" | "priority" | "reminderPolicy">;

function evaluateTaskImportance(task: ReminderTask): ReminderDecision {
  if (task.reminderPolicy === "never") return { eligible: false, reasons: [] };
  if (task.reminderPolicy === "always") return { eligible: true, reasons: ["task_override"] };
  if (task.priority === "high") return { eligible: true, reasons: ["high_priority"] };
  if (task.kind === "fixed") return { eligible: true, reasons: ["fixed_schedule"] };
  return { eligible: false, reasons: [] };
}

export function evaluateTaskReminder(task: ReminderTask, event: TaskReminderEvent): ReminderDecision {
  switch (event) {
    case "start":
    case "schedule_change":
      return evaluateTaskImportance(task);
  }
}

export function evaluateDailySummary(snapshot: ScheduleSnapshot): ReminderDecision {
  const capacity = calculateDailyCapacity(snapshot);
  const unfinished = snapshot.tasks.filter((task) => task.status !== "done" && task.reminderPolicy !== "never");
  const reasons = new Set<ReminderImportanceReason>();

  if (unfinished.some((task) => task.status === "blocked")) reasons.add("blocked_task");
  if (capacity.deadlineRiskCount > 0) reasons.add("deadline_risk");
  if (capacity.status === "impossible") reasons.add("impossible_capacity");
  if (unfinished.some((task) => task.priority === "high")) reasons.add("unhandled_high_priority");

  return { eligible: reasons.size > 0, reasons: [...reasons] };
}
