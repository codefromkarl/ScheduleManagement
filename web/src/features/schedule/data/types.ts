import type {
  AvailabilityWindow,
  ScheduleTask,
  ScheduledBlock,
  UnavailableWindow,
} from "../domain/types";

export type ScheduleSnapshot = {
  date: string;
  tasks: ScheduleTask[];
  blocks: ScheduledBlock[];
  availability: AvailabilityWindow[];
  unavailable: UnavailableWindow[];
  bufferMinutes: number;
  defaultDurationMinutes?: number;
};
