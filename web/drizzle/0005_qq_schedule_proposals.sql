CREATE TABLE `qq_schedule_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source_receipt_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`active_slot` text,
	`version` integer DEFAULT 1 NOT NULL,
	`intent` text NOT NULL,
	`preview` text NOT NULL,
	`expires_at` integer NOT NULL,
	`applied_change_set_id` text,
	`last_error` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_receipt_id`) REFERENCES `command_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_change_set_id`) REFERENCES `change_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qq_schedule_proposals_public_id_idx` ON `qq_schedule_proposals` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `qq_schedule_proposals_active_owner_idx` ON `qq_schedule_proposals` (`workspace_id`,`owner_id`,`active_slot`);--> statement-breakpoint
CREATE INDEX `qq_schedule_proposals_owner_status_idx` ON `qq_schedule_proposals` (`workspace_id`,`owner_id`,`status`,`expires_at`);