import type { ScheduleSnapshot } from "../data/types";

export type TimelineRange = { startMinutes: number; endMinutes: number };

export const DEFAULT_TIMELINE_RANGE: TimelineRange = { startMinutes: 8 * 60, endMinutes: 19 * 60 };

function floorHour(minutes: number) {
  return Math.max(0, Math.floor(minutes / 60) * 60);
}

function ceilHour(minutes: number) {
  return Math.min(24 * 60, Math.ceil(minutes / 60) * 60);
}

export function deriveTimelineRange(snapshot: Pick<ScheduleSnapshot, "availability" | "unavailable" | "blocks">): TimelineRange {
  const starts = [DEFAULT_TIMELINE_RANGE.startMinutes, ...snapshot.availability.map((item) => item.startMinutes), ...snapshot.unavailable.map((item) => item.startMinutes), ...snapshot.blocks.map((item) => item.startMinutes)];
  const ends = [DEFAULT_TIMELINE_RANGE.endMinutes, ...snapshot.availability.map((item) => item.endMinutes), ...snapshot.unavailable.map((item) => item.endMinutes), ...snapshot.blocks.map((item) => item.startMinutes + item.durationMinutes)];
  return { startMinutes: floorHour(Math.min(...starts)), endMinutes: ceilHour(Math.max(...ends)) };
}

export function expandTimelineRange(range: TimelineRange, startMinutes: number, durationMinutes: number): TimelineRange {
  return { startMinutes: floorHour(Math.min(range.startMinutes, startMinutes)), endMinutes: ceilHour(Math.max(range.endMinutes, startMinutes + durationMinutes)) };
}

export function timelineHours(range: TimelineRange) {
  return Array.from({ length: Math.floor((range.endMinutes - range.startMinutes) / 60) + 1 }, (_, index) => range.startMinutes / 60 + index);
}
