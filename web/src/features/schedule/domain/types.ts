export const TIME_GRANULARITY_MINUTES = 15;
export const DEFAULT_BUFFER_MINUTES = 15;

export type ScheduleKind = "fixed" | "flexible" | "floating";
export type TaskStatus = "todo" | "doing" | "blocked" | "done";
export type Priority = "low" | "normal" | "high";
export const REMINDER_POLICIES = ["auto", "always", "never"] as const;
export type ReminderPolicy = typeof REMINDER_POLICIES[number];
export type SchedulingMode = "rules" | "optimize";

export type TimeRange = {
  startMinutes: number;
  endMinutes: number;
};

export type AvailabilityWindow = TimeRange & {
  date: string;
};

export type UnavailableWindow = TimeRange & {
  date: string;
  reason: string;
};

export type ScheduleTask = {
  id: string;
  title: string;
  date: string;
  kind: ScheduleKind;
  priority: Priority;
  status: TaskStatus;
  reminderPolicy: ReminderPolicy;
  estimatedMinutes: number;
  movable: boolean;
  preferredStartMinutes?: number;
  /** Internal scheduling probe constraint; not persisted as a user task field. */
  exactStartMinutes?: number;
  deadlineMinutes?: number;
  projectId?: string;
  notes?: string;
};

export type ScheduledBlock = {
  id: string;
  taskId: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  kind: ScheduleKind;
  movable: boolean;
  title: string;
  priority?: Priority;
  projectId?: string;
};

export type ScheduleContext = {
  date: string;
  availability: AvailabilityWindow[];
  unavailable: UnavailableWindow[];
  existing: ScheduledBlock[];
  bufferMinutes?: number;
  mode?: SchedulingMode;
};

export type SchedulePlacement = {
  date: string;
  startMinutes: number;
  endMinutes: number;
};

export type ScheduleMove = {
  blockId: string;
  fromStartMinutes: number;
  toStartMinutes: number;
  durationMinutes: number;
};

export type ScheduleDecision = "auto" | "needs_confirmation" | "no_slot" | "needs_information";

export type ScheduleProposal = {
  decision: ScheduleDecision;
  placement?: SchedulePlacement;
  movedBlockIds: string[];
  moves: ScheduleMove[];
  reasons: string[];
};

export class ScheduleValidationError extends Error {
  constructor(public readonly code: "invalid_duration" | "invalid_time" | "missing_fixed_start" | "invalid_buffer", message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}
