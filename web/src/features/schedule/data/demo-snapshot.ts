import { placementToBlock } from "../domain/scheduler";
import type { ScheduleTask } from "../domain/types";
import type { ScheduleSnapshot } from "./types";

export function createDemoSnapshot(date: string): ScheduleSnapshot {
  const tasks: ScheduleTask[] = [
    { id: "weekly-sync", title: "产品周会", date, kind: "fixed", status: "done", priority: "normal", reminderPolicy: "auto", estimatedMinutes: 60, movable: false, preferredStartMinutes: 540, projectId: "工作推进" },
    { id: "roadmap", title: "梳理产品路线", date, kind: "flexible", status: "doing", priority: "high", reminderPolicy: "auto", estimatedMinutes: 90, movable: true, preferredStartMinutes: 630, projectId: "Goalset 产品" },
    { id: "customer-mail", title: "回复客户邮件", date, kind: "floating", status: "todo", priority: "normal", reminderPolicy: "auto", estimatedMinutes: 45, movable: true, deadlineMinutes: 960, projectId: "工作推进" },
    { id: "prototype", title: "完成首页原型", date, kind: "flexible", status: "todo", priority: "high", reminderPolicy: "auto", estimatedMinutes: 90, movable: true, deadlineMinutes: 1080, preferredStartMinutes: 900, projectId: "Goalset 产品" },
    { id: "notes", title: "整理今日笔记", date, kind: "floating", status: "todo", priority: "low", reminderPolicy: "auto", estimatedMinutes: 45, movable: true, deadlineMinutes: 1140, projectId: "Goalset 产品" },
  ];
  const starts = [540, 630, 810, 900, 1020];

  return {
    date,
    tasks,
    blocks: tasks.map((task, index) => placementToBlock(task, { date, startMinutes: starts[index], endMinutes: starts[index] + task.estimatedMinutes })),
    availability: [{ date, startMinutes: 540, endMinutes: 1080 }],
    unavailable: [{ date, startMinutes: 720, endMinutes: 780, reason: "午休" }],
    bufferMinutes: 15,
  };
}
