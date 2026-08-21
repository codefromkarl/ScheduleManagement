import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ReminderImportanceReason } from "@/features/schedule/domain/reminder-policy";
import { REMINDER_POLICIES } from "../../features/schedule/domain/types";
import { QQ_SCHEDULE_PROPOSAL_STATUSES, type QqScheduleProposalIntent, type QqScheduleProposalPreview } from "@/server/qq/schedule-proposal-types";

const taskKinds = ["fixed", "flexible", "floating"] as const;
const taskStatuses = ["todo", "doing", "blocked", "done"] as const;
const taskPriorities = ["low", "normal", "high"] as const;
const recurrenceFrequencies = ["daily", "weekly", "workday", "weekdays"] as const;
const occurrenceActions = ["skip", "move", "override"] as const;
const changeSetStatuses = ["proposed", "applied", "undone", "rejected"] as const;
const reminderKinds = ["start", "schedule_change", "daily_summary", "test"] as const;
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
  reminderPolicy: text("reminder_policy", { enum: REMINDER_POLICIES }).notNull().default("auto"),
  estimatedMinutes: integer("estimated_minutes").notNull(),
  movable: integer("movable", { mode: "boolean" }).notNull().default(true),
  preferredStartMinutes: integer("preferred_start_minutes"),
  deadlineMinutes: integer("deadline_minutes"),
  notes: text("notes"),
  source: text("source").notNull().default("web"),
  ...auditColumns,
}, (table) => [
  index("tasks_workspace_date_idx").on(table.workspaceId, table.date),
]);

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
  index("schedule_blocks_workspace_date_idx").on(table.workspaceId, table.date),
]);

export const availabilityRules = sqliteTable("availability_rules", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  weekday: integer("weekday").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...auditColumns,
}, (table) => [
  index("availability_rules_workspace_weekday_idx").on(table.workspaceId, table.weekday, table.enabled),
]);

export const unavailableWindows = sqliteTable("unavailable_windows", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  date: text("date").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  reason: text("reason").notNull(),
  ...auditColumns,
}, (table) => [
  index("unavailable_windows_workspace_date_idx").on(table.workspaceId, table.date),
]);

export const recurrenceRules = sqliteTable("recurrence_rules", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  frequency: text("frequency", { enum: recurrenceFrequencies }).notNull(),
  weekdays: text("weekdays", { mode: "json" }).$type<number[]>(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  ...auditColumns,
}, (table) => [
  index("recurrence_rules_task_idx").on(table.taskId),
]);

export const occurrenceOverrides = sqliteTable("occurrence_overrides", {
  id: text("id").primaryKey(),
  recurrenceId: text("recurrence_id").notNull().references(() => recurrenceRules.id),
  occurrenceDate: text("occurrence_date").notNull(),
  action: text("action", { enum: occurrenceActions }).notNull(),
  startMinutes: integer("start_minutes"),
  durationMinutes: integer("duration_minutes"),
  note: text("note"),
  ...auditColumns,
}, (table) => [
  index("occurrence_overrides_recurrence_date_idx").on(table.recurrenceId, table.occurrenceDate),
]);

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
}, (table) => [
  index("change_sets_workspace_created_idx").on(table.workspaceId, table.createdAt),
]);

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
  importanceReasons: text("importance_reasons", { mode: "json" }).$type<ReminderImportanceReason[]>(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }),
  error: text("error"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("reminders_dedupe_idx").on(table.workspaceId, table.dedupeKey),
  index("reminders_delivery_due_idx").on(table.channel, table.status, table.scheduledAt),
  index("reminders_workspace_created_idx").on(table.workspaceId, table.createdAt),
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
  index("command_receipts_pending_confirmation_idx").on(table.workspaceId, table.channel, table.senderId, table.status, table.createdAt),
]);

export const qqScheduleProposals = sqliteTable("qq_schedule_proposals", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  ownerId: text("owner_id").notNull(),
  sourceReceiptId: text("source_receipt_id").notNull().references(() => commandReceipts.id),
  status: text("status", { enum: QQ_SCHEDULE_PROPOSAL_STATUSES }).notNull().default("pending"),
  activeSlot: text("active_slot"),
  version: integer("version").notNull().default(1),
  intent: text("intent", { mode: "json" }).$type<QqScheduleProposalIntent>().notNull(),
  preview: text("preview", { mode: "json" }).$type<QqScheduleProposalPreview>().notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  appliedChangeSetId: text("applied_change_set_id").references(() => changeSets.id),
  lastError: text("last_error"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("qq_schedule_proposals_public_id_idx").on(table.publicId),
  uniqueIndex("qq_schedule_proposals_active_owner_idx").on(table.workspaceId, table.ownerId, table.activeSlot),
  index("qq_schedule_proposals_owner_status_idx").on(table.workspaceId, table.ownerId, table.status, table.expiresAt),
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
