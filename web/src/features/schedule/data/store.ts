import type { ScheduleTask } from "../domain/types";
import type { InsertTaskResult, ScheduleMutationOptions, ScheduleStore } from "./store-types";
import type { ScheduleSnapshot } from "./types";

export type { InsertTaskResult, ScheduleStore } from "./store-types";

export type ScheduleRepository = ScheduleStore & {
  getSnapshot(date: string): Promise<ScheduleSnapshot>;
  insertTask(task: ScheduleTask, options?: ScheduleMutationOptions): Promise<InsertTaskResult>;
};
