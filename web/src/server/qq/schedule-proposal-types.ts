import type { ScheduleDecision, ScheduleMove, SchedulePlacement, ScheduleTask, SchedulingMode } from "@/features/schedule/domain/types";

export const QQ_SCHEDULE_PROPOSAL_STATUSES = ["pending", "applying", "superseded", "cancelled", "expired", "applied"] as const;
export type QqScheduleProposalStatus = (typeof QQ_SCHEDULE_PROPOSAL_STATUSES)[number];

export type QqScheduleProposalIntent =
  | { kind: "insert"; task: ScheduleTask; mode: SchedulingMode; originalCommand: string }
  | { kind: "reschedule"; taskId: string; taskTitle: string; durationMinutes: number; originDate: string; date: string; startMinutes: number; mode: SchedulingMode; originalCommand: string };

export type QqScheduleMovePreview = ScheduleMove & { title: string };
export type QqScheduleContextBlock = { id: string; title: string; startMinutes: number; durationMinutes: number; kind: ScheduleTask["kind"] };

export type QqScheduleProposalPreview = {
  decision: ScheduleDecision;
  taskTitle: string;
  date: string;
  durationMinutes: number;
  placement?: SchedulePlacement;
  moves: QqScheduleMovePreview[];
  contextBlocks: QqScheduleContextBlock[];
  crossDate: boolean;
  occupiedNoSlot: boolean;
  reasons: string[];
  baseFingerprint: string;
};
