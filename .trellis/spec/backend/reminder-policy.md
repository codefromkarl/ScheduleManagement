# Important Reminder Policy

## 1. Scope / Trigger

This contract applies whenever task fields, schedule mutations, reminder workers, reminder APIs, or task-detail reminder controls change. Goalset filters reminder importance before inserting outbox rows; QQ/PWA adapters only deliver already-eligible reminders.

## 2. Signatures

```ts
type ReminderPolicy = "auto" | "always" | "never";

evaluateTaskReminder(
  task: Pick<ScheduleTask, "kind" | "priority" | "reminderPolicy">,
  event: "start" | "schedule_change",
): { eligible: boolean; reasons: ReminderImportanceReason[] }

evaluateDailySummary(
  snapshot: ScheduleSnapshot,
): { eligible: boolean; reasons: ReminderImportanceReason[] }
```

```text
PATCH /api/tasks/:id
{ reminderPolicy?: "auto" | "always" | "never" }

tasks.reminder_policy TEXT NOT NULL DEFAULT 'auto'
reminders.importance_reasons JSON nullable
```

## 3. Contracts

- `auto` is the backward-compatible default for existing, API-created, AI-created, QQ-created, seeded, and recurring tasks.
- Automatic task reminders are eligible only for high-priority tasks or fixed schedules. Start reminders are scheduled at T-15 minutes.
- `always` makes that task's start and schedule-change events eligible. `never` suppresses those task-specific events.
- A schedule-change reminder is inserted only if at least one affected task is eligible. Move proposals must resolve every moved block ID back to its task ID before evaluation.
- Daily summaries are scheduled for 09:00 `Asia/Shanghai` and inserted only for blocked tasks, deadline risk, impossible capacity, or unfinished high-priority work.
- Task-level `never` does not hide aggregate capacity risk because capacity describes the whole schedule.
- `importanceReasons` records the stable policy reasons that the Web notification history and channel message use for explanation.
- Channel configuration, authorization, claims, delivery, retries, and failures remain outside the importance policy. A missing QQ configuration creates no QQ row and never blocks Web scheduling.
- Updating priority or `reminderPolicy` recalculates a pending start reminder without rewriting task kind, priority, placement, or sent reminder history.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing `reminderPolicy` on an incoming task | Runtime decoder normalizes it to `auto`. |
| Invalid reminder policy | `400 INVALID_REQUEST`; do not mutate the task. |
| Normal/low non-fixed task with `auto` | Do not enqueue task-specific reminders. |
| High/fixed task with `never` | Do not enqueue task-specific reminders. |
| Normal task with `always` | Enqueue eligible start/change reminders when the channel is configured. |
| No daily risk at 09:00 | Do not insert an “all normal” summary. |
| QQ/PWA delivery fails | Preserve schedule/task state; mark the outbox row failed and allow bounded retry. |
| Duplicate event/worker polling | Stable dedupe key plus unique index produces one reminder effect. |
| Host timezone differs from Shanghai | `dailySummaryTime()` still maps local 09:00 to the correct UTC instant. |

## 5. Good / Base / Bad Cases

- Good: a high-priority flexible task with `auto` receives a T-15 reminder carrying `high_priority`; setting it to `never` removes only its pending start reminder.
- Base: a normal flexible task stays `auto`, remains visible in Web history, and produces no QQ noise.
- Bad: `configuredReminderChannels()` is treated as permission to enqueue every task update, or the QQ worker reimplements high/fixed rules.
- Bad: changing a task's reminder setting silently changes its priority or kind.

## 6. Tests Required

- Unit-test automatic, `always`, and `never` task decisions for both task-specific event kinds.
- Unit-test risk-free and blocked/deadline/impossible/high-priority daily summary decisions.
- Assert 09:00 Shanghai serializes to the expected UTC instant independent of the test host timezone.
- SQLite integration must migrate old tasks to `auto` and round-trip `importanceReasons` JSON.
- Browser coverage must persist all three task-detail values through `PATCH /api/tasks/:id` and show truthful QQ-unconfigured copy.
- Existing atomic claim, deduplication, retry, schedule rollback, and recurrence materialization tests remain required.

## 7. Wrong vs Correct

### Wrong

```ts
// Channel availability is not reminder importance.
if (qqIsConfigured()) enqueueEveryTaskChange();
```

### Correct

```ts
const decision = evaluateTaskReminder(task, "schedule_change");
if (decision.eligible) {
  enqueueReminder({ importanceReasons: decision.reasons });
}
```
