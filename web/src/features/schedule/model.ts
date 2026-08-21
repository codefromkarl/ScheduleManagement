import type { Priority, ReminderPolicy, ScheduleKind, ScheduleTask, TaskStatus } from "./domain/types";
import { rankUnplannedTasks } from "./domain/unplanned";
import { createDemoSnapshot } from "./data/demo-snapshot";
import type { ScheduleSnapshot } from "./data/types";

export type { Priority, ReminderPolicy, ScheduleKind, TaskStatus } from "./domain/types";

export type ScheduleItem = {
  id: string;
  taskId: string;
  date: string;
  title: string;
  kind: ScheduleKind;
  status: TaskStatus;
  priority: Priority;
  reminderPolicy: ReminderPolicy;
  project: string;
  startMinutes: number;
  durationMinutes: number;
  tone: string;
  note: string;
  notes?: string;
};

export type UnplannedTask = Pick<ScheduleTask, "id" | "title" | "date" | "kind" | "status" | "priority" | "estimatedMinutes" | "preferredStartMinutes" | "deadlineMinutes" | "projectId">;

export const KIND_LABELS: Record<ScheduleKind, string> = {
  fixed: "固定",
  flexible: "弹性",
  floating: "浮动",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待开始",
  doing: "进行中",
  blocked: "已阻塞",
  done: "已完成",
};

function toneForKind(kind: ScheduleKind) {
  return {
    fixed: "schedule-item--blue",
    flexible: "schedule-item--orange",
    floating: "schedule-item--green",
  }[kind];
}

export function scheduleItemsFromSnapshot(snapshot: ScheduleSnapshot): ScheduleItem[] {
  return snapshot.blocks.flatMap((block) => {
    const task = snapshot.tasks.find((item) => item.id === block.taskId);
    if (!task) return [];
    return [{
      id: block.id,
      taskId: task.id,
      date: block.date,
      title: task.title,
      kind: task.kind,
      status: task.status,
      priority: task.priority,
      reminderPolicy: task.reminderPolicy,
      project: task.projectId ?? "未分类",
      startMinutes: block.startMinutes,
      durationMinutes: block.durationMinutes,
      tone: toneForKind(task.kind),
      note: task.kind === "fixed" ? "固定安排 · 不自动移动" : `${KIND_LABELS[task.kind]}任务 · 预计 ${formatDuration(task.estimatedMinutes)}`,
      notes: task.notes,
    }];
  });
}

export function unplannedTasksFromSnapshot(snapshot: ScheduleSnapshot): UnplannedTask[] {
  const scheduledTaskIds = new Set(snapshot.blocks.map((block) => block.taskId));
  return rankUnplannedTasks(snapshot.tasks.filter((task) => task.status !== "done" && !scheduledTaskIds.has(task.id)))
    .map(({ id, title, date, kind, status, priority, estimatedMinutes, preferredStartMinutes, deadlineMinutes, projectId }) => ({ id, title, date, kind, status, priority, estimatedMinutes, preferredStartMinutes, deadlineMinutes, projectId }));
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export const PROJECTS = [
  { name: "全部安排", count: 8, tone: "#5d63e9" },
  { name: "Goalset 产品", count: 4, tone: "#ed8b55" },
  { name: "工作推进", count: 3, tone: "#45aa91" },
  { name: "个人生活", count: 1, tone: "#b47bea" },
];

export const DEMO_ITEMS = scheduleItemsFromSnapshot(createDemoSnapshot("2026-08-20"));

export const TIMELINE_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
