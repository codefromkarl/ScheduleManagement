import { scheduleStore } from "./in-memory-store";
import { sqliteScheduleStore } from "./sqlite-store";
import type { ScheduleStore } from "./store-types";

export function getActiveScheduleStore(): ScheduleStore {
  return process.env.DATABASE_URL ? sqliteScheduleStore : scheduleStore;
}
