import type { ScheduleProposal, ScheduleTask, SchedulingMode } from "../domain/types";
import type { ScheduleSnapshot } from "./types";

export type InsertTaskResult = {
  proposal: ScheduleProposal;
  snapshot: ScheduleSnapshot;
  changeSetId?: string;
};

export type TaskUpdateAudit = { source?: string; originalCommand?: string };
export type ScheduleMutationOptions = { mode?: SchedulingMode; source?: string };
export type ScheduleExistingTaskOptions = ScheduleMutationOptions & { startMinutes?: number; confirm?: boolean };
export type RescheduleTaskOptions = ScheduleMutationOptions & { confirm?: boolean };

export type RescheduleTaskResult = { taskId: string; date: string; startMinutes: number; proposal: ScheduleProposal; snapshot: ScheduleSnapshot; changeSetId?: string };
export type ScheduleExistingTaskResult = { taskId: string; date: string; proposal: ScheduleProposal; snapshot: ScheduleSnapshot; changeSetId?: string };

export type ScheduleStore = {
  getSnapshot(date: string): Promise<ScheduleSnapshot>;
  insertTask(task: ScheduleTask, options?: ScheduleMutationOptions): Promise<InsertTaskResult>;
  confirmTask(task: ScheduleTask, options?: ScheduleMutationOptions): Promise<InsertTaskResult>;
  scheduleTask(taskId: string, date: string, options: ScheduleExistingTaskOptions): Promise<ScheduleExistingTaskResult>;
  undoChangeSet(changeSetId: string): Promise<ScheduleSnapshot>;
  updateTask(taskId: string, changes: Partial<Pick<ScheduleTask, "title" | "status" | "priority" | "notes">>, audit?: TaskUpdateAudit): Promise<ScheduleSnapshot>;
  rescheduleTask(taskId: string, date: string, startMinutes: number, options?: RescheduleTaskOptions): Promise<RescheduleTaskResult>;
  deleteTask(taskId: string): Promise<ScheduleSnapshot>;
};
