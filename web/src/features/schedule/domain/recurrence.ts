import type { RecurrenceFrequency } from "./recurrence-types";

export type RecurrenceRuleInput = {
  frequency: RecurrenceFrequency;
  weekdays?: number[];
  startDate: string;
  endDate?: string;
};

export type OccurrenceOverride = {
  occurrenceDate: string;
  action: "skip" | "move" | "override";
  startMinutes?: number | null;
  durationMinutes?: number | null;
  note?: string | null;
};

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isRealDate(key: string) {
  const date = dateFromKey(key);
  const [year, month, day] = key.split("-").map(Number);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function generateOccurrenceDates(rule: RecurrenceRuleInput, rangeStart: string, rangeEnd: string) {
  if (!isRealDate(rule.startDate) || (rule.endDate && !isRealDate(rule.endDate)) || !isRealDate(rangeStart) || !isRealDate(rangeEnd)) throw new Error("INVALID_DATE");
  if (rangeEnd < rangeStart) throw new Error("INVALID_RANGE");
  const start = rule.startDate > rangeStart ? rule.startDate : rangeStart;
  const end = rule.endDate && rule.endDate < rangeEnd ? rule.endDate : rangeEnd;
  if (start > end) return [];

  const selectedWeekdays = new Set(rule.weekdays ?? []);
  const result: string[] = [];
  for (let cursor = dateFromKey(start); dateKey(cursor) <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const current = dateKey(cursor);
    const weekday = cursor.getUTCDay();
    const matches = rule.frequency === "daily"
      || (rule.frequency === "workday" && weekday >= 1 && weekday <= 5)
      || (rule.frequency === "weekly" && (selectedWeekdays.size === 0 ? weekday === dateFromKey(rule.startDate).getUTCDay() : selectedWeekdays.has(weekday)))
      || (rule.frequency === "weekdays" && selectedWeekdays.has(weekday));
    if (matches) result.push(current);
  }
  return result;
}

export function applyOccurrenceOverrides(dates: string[], overrides: OccurrenceOverride[]) {
  const byDate = new Map(overrides.map((override) => [override.occurrenceDate, override]));
  return dates.flatMap((date) => {
    const override = byDate.get(date);
    if (!override || override.action !== "skip") return [{ date, override: override ?? null }];
    return [];
  });
}
