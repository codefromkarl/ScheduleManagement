import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const taskKinds = ["fixed", "flexible", "floating"] as const;
const taskStatuses = ["todo", "doing", "blocked", "done"] as const;
const taskPriorities = ["low", "normal", "high"] as const;
const recurrenceFrequencies = ["daily", "weekly", "workday", "weekdays"] as const;
const occurrenceActions = ["skip", "move", "override"] as const;
const changeSetStatuses = ["proposed", "applied", "undone", "rejected"] as const;
const reminderKinds = ["start", "schedule_change", "daily_summary"] as const;
const reminderChannels = ["qq", "pwa"] as const;
const reminderStatuses = ["pending", "sending", "sent", "failed", "cancelled"] as const;
const commandReceiptStatuses = ["received", "pending_confirmation", "processed", "failed"] as const;
const workerStatuses = ["starting", "running", "success", "error", "stopped"] as const;

const auditColumns = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).defaultNow().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).defaultNow().notNull(),
};

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  ...auditColumns,
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  tone: text("tone").notNull().default("#5d63e9"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...auditColumns,
}, (table) => [
  uniqueIndex("projects_workspace_name_idx").on(table.workspaceId, table.name),
]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  projectId: text("project_id").references(() => projects.id),
  title: text("title").notNull(),
  date: text("date").notNull(),
  kind: text("kind", { enum: taskKinds }).notNull(),
  status: text("status", { enum: taskStatuses }).notNull().default("todo"),
  priority: text("priority", { enum: taskPriorities }).notNull().default("normal"),
  estimatedMinutes: integer("estimated_minutes").notNull(),
  movable: integer("movable", { mode: "boolean" }).notNull().default(true),
  preferredStartMinutes: integer("preferred_start_minutes"),
  deadlineMinutes: integer("deadline_minutes"),
  notes: text("notes"),
  source: text("source").notNull().default("web"),
  ...auditColumns,
});

export const scheduleBlocks = sqliteTable("schedule_blocks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  date: text("date").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  kind: text("kind", { enum: taskKinds }).notNull(),
  movable: integer("movable", { mode: "boolean" }).notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("schedule_blocks_task_placement_idx").on(table.taskId, table.date, table.startMinutes),
]);

export const availabilityRules = sqliteTable("availability_rules", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  weekday: integer("weekday").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...auditColumns,
});

export const unavailableWindows = sqliteTable("unavailable_windows", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  date: text("date").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  reason: text("reason").notNull(),
  ...auditColumns,
});

export const recurrenceRules = sqliteTable("recurrence_rules", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  frequency: text("frequency", { enum: recurrenceFrequencies }).notNull(),
  weekdays: text("weekdays", { mode: "json" }).$type<number[]>(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  ...auditColumns,
});

export const occurrenceOverrides = sqliteTable("occurrence_overrides", {
  id: text("id").primaryKey(),
  recurrenceId: text("recurrence_id").notNull().references(() => recurrenceRules.id),
  occurrenceDate: text("occurrence_date").notNull(),
  action: text("action", { enum: occurrenceActions }).notNull(),
  startMinutes: integer("start_minutes"),
  durationMinutes: integer("duration_minutes"),
  note: text("note"),
  ...auditColumns,
});

export const preferences = sqliteTable("preferences", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  key: text("key").notNull(),
  value: text("value", { mode: "json" }).notNull(),
  confidence: real("confidence").notNull().default(1),
  source: text("source").notNull().default("user"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("preferences_workspace_key_idx").on(table.workspaceId, table.key),
]);

export const changeSets = sqliteTable("change_sets", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  source: text("source").notNull(),
  originalCommand: text("original_command"),
  parsedIntent: text("parsed_intent", { mode: "json" }),
  beforeState: text("before_state", { mode: "json" }).notNull(),
  afterState: text("after_state", { mode: "json" }).notNull(),
  status: text("status", { enum: changeSetStatuses }).notNull().default("proposed"),
  ...auditColumns,
});

export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  taskId: text("task_id").references(() => tasks.id),
  blockId: text("block_id").references(() => scheduleBlocks.id),
  kind: text("kind", { enum: reminderKinds }).notNull(),
  channel: text("channel", { enum: reminderChannels }).notNull(),
  scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status", { enum: reminderStatuses }).notNull().default("pending"),
  dedupeKey: text("dedupe_key").notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  error: text("error"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("reminders_dedupe_idx").on(table.workspaceId, table.dedupeKey),
]);

export const channelIdentities = sqliteTable("channel_identities", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  channel: text("channel").notNull(),
  externalUserId: text("external_user_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...auditColumns,
}, (table) => [
  uniqueIndex("channel_identities_identity_idx").on(table.channel, table.externalUserId),
]);

export const commandReceipts = sqliteTable("command_receipts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  channel: text("channel").notNull(),
  externalMessageId: text("external_message_id").notNull(),
  senderId: text("sender_id").notNull(),
  status: text("status", { enum: commandReceiptStatuses }).notNull().default("received"),
  payload: text("payload", { mode: "json" }),
  responseText: text("response_text"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("command_receipts_external_message_idx").on(table.channel, table.externalMessageId),
]);

export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  workerName: text("worker_name").notNull(),
  status: text("status", { enum: workerStatuses }).notNull().default("starting"),
  lastStartedAt: integer("last_started_at", { mode: "timestamp_ms" }),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  metadata: text("metadata", { mode: "json" }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("worker_heartbeats_worker_idx").on(table.workspaceId, table.workerName),
]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
]);
