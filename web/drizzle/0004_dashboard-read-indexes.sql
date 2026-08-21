CREATE INDEX `availability_rules_workspace_weekday_idx` ON `availability_rules` (`workspace_id`,`weekday`,`enabled`);--> statement-breakpoint
CREATE INDEX `change_sets_workspace_created_idx` ON `change_sets` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `command_receipts_pending_confirmation_idx` ON `command_receipts` (`workspace_id`,`channel`,`sender_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `occurrence_overrides_recurrence_date_idx` ON `occurrence_overrides` (`recurrence_id`,`occurrence_date`);--> statement-breakpoint
CREATE INDEX `recurrence_rules_task_idx` ON `recurrence_rules` (`task_id`);--> statement-breakpoint
CREATE INDEX `reminders_delivery_due_idx` ON `reminders` (`channel`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `reminders_workspace_created_idx` ON `reminders` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `schedule_blocks_workspace_date_idx` ON `schedule_blocks` (`workspace_id`,`date`);--> statement-breakpoint
CREATE INDEX `tasks_workspace_date_idx` ON `tasks` (`workspace_id`,`date`);--> statement-breakpoint
CREATE INDEX `unavailable_windows_workspace_date_idx` ON `unavailable_windows` (`workspace_id`,`date`);