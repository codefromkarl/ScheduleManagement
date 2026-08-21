# 个人任务进度管理网站技术设计（草案）

## Status

Approved implementation baseline. The QQ private-message capability, account eligibility, transport mode, and sandbox rules remain a feasibility gate for the QQ adapter only.

## Design Goals

- Make the calendar/schedule the primary product surface.
- Keep deterministic scheduling rules outside the language model.
- Make deterministic, no-move placement the default; AI reordering is an explicit opt-in operation, never an implicit consequence of task creation.
- Let website chat and QQ private messages call the same command and scheduling service.
- Make low-risk temporary-task insertion fast, while keeping high-risk changes reviewable and reversible.
- Work across desktop and mobile through one responsive Web/PWA client.
- Keep the application useful when QQ, reminders, or the AI provider is unavailable.

## Initial Non-Goals

- Team collaboration, invitations, roles, and comments.
- QQ Space/QQ Channel publishing or social-content operations.
- Reading the user's complete QQ chat history.
- Third-party calendar synchronization.
- A complex project hierarchy, Gantt chart, resource planner, or custom workflow engine.
- Unreviewed autonomous deletion or broad schedule rewrites.

## Recommended System Shape

Use a TypeScript modular monolith with a separate background worker process. The first deployment can run as a small Docker Compose stack on a private personal server or cloud VM.

```text
Desktop Web/PWA             QQ Official Bot
       │                           │
       └──────────────┬────────────┘
                      ▼
             Channel adapter layer
                      ▼
          Command + conversation service
                      ▼
       AI intent parser / tool orchestrator
                      ▼
       Deterministic scheduling domain core
              │                    │
              ▼                    ▼
          SQLite              Change-set audit
              │                    │
              └──────────┬─────────┘
                         ▼
                Reminder/job dispatcher
                    │             │
                    ▼             ▼
                QQ reply      PWA notification
```

The AI may propose an operation, but it must not write schedule rows directly. All mutations pass through typed domain commands, constraint validation, a transaction, and an auditable change set.

## Domain Boundaries

### Schedule and task domain

- `Task`: semantic work item or commitment. It carries title, type, project, status, estimated minutes, priority, due time, notes, and source.
- `ScheduleBlock`: a concrete placement of a task or fixed arrangement on the timeline, with start/end, origin, and whether it is movable.
- `TaskType`: `fixed`, `flexible`, or `floating`.
- `RecurrenceRule`: daily, weekly, workday, or selected weekdays with start/end dates.
- `OccurrenceOverride`: a single skip, move, or override that does not mutate the parent recurrence rule.
- `Project`: optional lightweight grouping for tasks and progress; no deep nested hierarchy in MVP.

Keep the task and its placement separate. A task can be rescheduled without losing its identity, and a recurring task can produce multiple occurrences without copying unrelated metadata.

### Availability and constraints

- `AvailabilityRule`: weekly usable windows.
- `UnavailableWindow`: sleep, do-not-disturb, leave, travel, or one-off unavailable periods.
- `ScheduleConstraint`: fixed placement, hard deadline, movable flag, buffer preference, or other explicit rule.
- Time is stored with an explicit timezone policy. The initial user timezone should be configurable rather than inferred from the server.

The scheduler treats fixed arrangements, unavailable windows, and hard deadlines as hard constraints. Priority, preferred time, project continuity, and buffer are soft constraints used for scoring candidate schedules.

### AI preferences

Store learned preferences as visible records, not hidden prompt memory. Examples include default duration by task category, preferred deep-work windows, and normal transition buffer. Every learned preference should have a source, confidence, last-used time, and an explicit reset path.

### Change sets and audit

Every AI mutation creates an `AIChangeSet` containing:

- original channel message and normalized command;
- parsed fields and confidence;
- affected tasks and schedule blocks;
- before/after snapshots or reversible operations;
- reason and constraint explanation;
- confirmation state, actor, timestamps, and undo status.

Undo applies the inverse change set in a new transaction; it does not rewrite history.

## Scheduling Contract

The scheduling core operates in 15-minute units and supports non-hour durations such as 45 minutes. A default 15-minute transition buffer is applied unless the user's preference or task rule overrides it.

Candidate generation should follow this order:

1. Normalize the requested task and fill only high-confidence defaults.
2. Load the relevant date range, availability, fixed blocks, recurrence instances, projects, preferences, and current task placements.
3. Generate available 15-minute slots that satisfy hard constraints.
4. In normal rule mode, choose an exact requested time, otherwise the closest safe slot to an explicit preferred time, otherwise the earliest safe slot. Priority, project continuity, and fragmentation must not alter normal placement.
5. If an empty slot exists, insert the task without moving anything.
6. If no empty slot exists during normal task creation, preserve all existing blocks and keep the new task unplanned.
7. Only an explicit AI-optimization command may request candidate reordering or movement of elastic tasks; the deterministic domain still validates every candidate.
8. Any plan that moves an existing task is previewed and requires confirmation before a transaction is applied.
9. Apply a confirmed plan transactionally, enqueue reminders, and return a concise summary plus a detailed Web link when available.

AI optimization may use deadline pressure, priority, preferred hours, project continuity, and fragmentation as soft scoring inputs, but hard constraints remain deterministic and the resulting movement plan remains a proposal until confirmed.

Tasks without a reliable duration or deadline should not be counted as confidently schedulable. The AI should ask for the smallest missing fact, or show an estimate for confirmation when its confidence is high.

Project progress uses completed estimated minutes divided by the estimated minutes of known project tasks. Tasks without an accepted estimate are shown separately as “missing estimate” and do not silently count as zero effort. Health status is derived from overdue work, blocked tasks, and deadline feasibility.

## AI Command Contract

The model produces a validated structured intent, not arbitrary database operations. Initial intents include:

- create or capture a task;
- insert a temporary task;
- reschedule or split an existing task;
- update status or progress note;
- set or explain a preference;
- confirm a proposed change set;
- undo a change set;
- ask for the current schedule or project risk.

The orchestrator should provide only the relevant context window, use schema validation, and route mutations through domain services. The website and QQ channels must share this contract.

## Channel Design

### Website chat

The website chat is the full interaction surface. It shows parsed task fields, candidate schedule changes, affected items, and confirm/undo actions. It can link directly to the Dashboard and change history.

Ordinary chat messages do not authorize reordering. AI reordering is entered only through a dedicated “AI 优化日程” action that adds an explicit optimization intent to the command envelope; task text alone must never infer this permission.

### QQ private-message Bot

Use the official QQ Bot application model rather than personal-account automation. The first version should bind one allowlisted QQ identity to the user's account and ignore or reject other senders. Normalize incoming C2C messages into the same command envelope used by website chat.

Initial owner discovery uses a supervised ten-minute pairing process with an exact random six-digit C2C command. A wrong code or non-C2C message has no effect, and an existing owner cannot be silently replaced. After discovery, the production worker returns to exact `senderId === QQBOT_OWNER_USER_ID` authorization.

QQ is a thin Goalset channel: morning/task reminders flow out, and sudden-task commands flow in. A direct QQ SDK adapter, QR connector, or isolated AstrBot gateway may own transport, but none may run a second task scheduler, persist a competing task model, or let its own Agent bypass Goalset confirmation and ChangeSet rules.

The QQ adapter must handle message IDs, duplicate delivery, sender authorization, rate limits, retries, and concise replies. Detailed change previews should link to the private Web app when text is too long. The user has selected QQ as the only active reminder and sudden-task channel; channel enablement remains separate from reminder-importance policy so ordinary low-risk state changes are not sent indiscriminately.

Channel-level receipt and help phrases are reserved before natural-language task parsing. This prevents delivery acceptance messages from becoming incomplete tasks while keeping near-match task sentences available to the normal command service. Delayed transport acceptance uses the same reminder outbox with a future `scheduledAt`, not an adapter-local timer.

QQ reordering requires a strict command prefix: “优化日程” or “AI 重排”. Messages without one of these prefixes remain ordinary task commands and may use only no-move deterministic placement.

The exact QQ transport (long-lived connection or webhook), private-message intent, sandbox workflow, and account eligibility remain a feasibility gate. The adapter boundary must permit either transport without changing the scheduling domain.

Do not treat connector documentation or an accepted API request as proactive-delivery proof. The QQ-only choice deliberately has no fallback until a real scheduled message arrives outside the passive-reply window and still arrives exactly once across worker restart. Settings must expose this unverified state rather than claiming reliable delivery.

### PWA notifications

PWA notification support remains implemented but is not selected for the current rollout. `REMINDER_CHANNELS=qq` prevents new PWA outbox rows, the PWA worker stays stopped, and no Tailscale Serve deployment is required. If the user later re-enables PWA, browser permission denial or service-worker failure must still remain independent from task state and the existing provider-versus-device receipt evidence remains required.

### Reminder importance policy

Reminder importance is a deterministic domain policy evaluated before channel delivery. Enabling QQ does not itself make every reminder eligible for QQ.

- Start reminders are important when the task priority is `high` or the scheduled block is `fixed`; eligible reminders fire 15 minutes before the block starts.
- Schedule-change reminders are important only when at least one affected task is high priority or one affected block is fixed.
- Daily summaries are generated only when the selected day contains an overdue task, a blocked task, an impossible capacity projection, or an unhandled high-priority task. The default dispatch time is 09:00 in `Asia/Shanghai`; date and time calculations must not inherit the host timezone.
- Ordinary task completion, ordinary low-risk rescheduling, and normal/low non-fixed task starts remain visible in Web history but do not enqueue QQ reminders by default.

The policy result should include a stable reason/category so Settings and reminder history can explain why a message was or was not eligible. Channel delivery continues to own authorization, deduplication, retries, and transport failures; it must not reimplement importance decisions.

Each task stores a `reminderPolicy` value with `auto`, `always`, and `never`; existing and newly created tasks default to `auto`. `always` makes task-start and task-affecting schedule-change events eligible even when the automatic rule would not. `never` suppresses task-specific start and schedule-change events. System-level capacity risk remains eligible for the aggregate daily summary because it describes the whole schedule rather than only one task. Recurring occurrences inherit the template policy when materialized, while a future occurrence-specific override may change only that occurrence.

The field belongs to the task domain and typed task API, not the QQ adapter. The task detail surface exposes it under advanced settings, using user-facing labels `自动`, `强制提醒`, and `不提醒`; changing it must not mutate priority, kind, or scheduling constraints.

## Frontend Information Architecture

- Dashboard: desktop defaults to a week-planning workspace with a shared vertical time scale and seven real day columns (Monday through Sunday), plus actionable unplanned/capacity/risk context. Week mode renders each task at its actual day/time and supports task detail plus validated cross-day drag/drop; it is not a date selector followed by a single-day timeline. Mobile defaults to a today-execution workspace with the current date and day timeline first. Both can switch day/week modes without changing schedule data.
- Dashboard density: omit the separate next-task card and completed/scheduled summary strip. The timetable, compact unplanned entry, calendar free-capacity copy, and activity/risk Sheet remain the truthful sources for those decisions.
- Weekly block hierarchy: the persistent block surface shows title plus explicit start–end time at a readable size. Existing kind colors/borders remain the compact semantic cue; full title, kind, status, project, and duration move to an accessible hover/focus disclosure and the existing task-detail Sheet. This is a presentation-only projection and does not alter `ScheduleItem`, scheduling, drag payloads, or API contracts.
- Mobile date navigation: day mode always exposes previous day, next day, and explicit date selection as touch targets. Selecting another date preserves day mode unless the user explicitly switches to week mode.
- Unplanned tray: a compact Dashboard section above the timeline, hidden when empty, showing three priority/deadline-ranked tasks by default with expand, exact-time, and explicit AI-optimization actions.
- AI chat: command entry, parsed intent, candidate plans, confirmation, and undo.
- Project view: tasks, weighted progress, health, blockers, and recent changes.
- Task detail: type, placement, estimate, priority, deadline, flexibility, recurrence, notes, and audit history.
- Settings: availability, do-not-disturb, buffer, AI preferences, notification channels, account, backup, and provider configuration.
- Change history: searchable list of AI and manual changes with reversible recent operations.

The responsive layout should keep the selected date, calendar, and one primary action visible on mobile; advanced editing can open a bottom sheet or dedicated detail page. Desktop planning context must not be hidden entirely behind an activity sheet when the same information is needed to make weekly scheduling decisions.

Desktop unplanned cards may use native drag-and-drop onto the day timeline. The drop coordinate is converted to a 15-minute-aligned exact start and sent through the same typed reschedule/place command as the accessible click-to-select-time path. Mobile and keyboard users must be able to complete the same placement without dragging. Invalid drops never choose a different slot implicitly and leave the task unplanned.

The draggable unplanned source lives in the compact Dashboard entry, outside modal focus/overlay layers. It exposes the highest-ranked three tasks without adding another full list; the Sheet owns the complete list and non-drag actions. Drag payloads carry task identity plus duration so the timeline can render a start–end ghost, but only the existing `scheduleTask` command can persist a block.

Scheduled flexible/floating blocks use the existing exact reschedule command for drag and click placement; fixed blocks expose click-to-edit only and do not set a drag payload. A rejected exact target preserves the original block and returns enough proposal data for the Dashboard to render a temporary red conflict marker at the attempted time.

Conflict feedback is a narrow attempted-time marker rather than a replacement card, keeping the actual blocker visible. SQLite and the no-database in-memory adapter both resolve the task/block from its origin date before validating the target snapshot, then remove origin placement and insert target placement atomically within their respective adapter semantics.

Batch rules scheduling is a store-owned transaction: derive unplanned tasks from one snapshot, sort by priority/deadline/title, simulate rules-only placement against a growing working block set, insert successful blocks/reminders in one transaction, and record one reversible ChangeSet. Daily close is also transactional and applies only to incomplete non-fixed tasks; it removes their blocks and optionally changes their date to tomorrow while retaining task identity.

Playwright starts a dedicated Next server against `data/goalset-e2e.db`, migrates that file before launch, uses unique task IDs/dates, and cleans API fixtures. It must never point at the personal `data/goalset.db` by default.

Cross-date unplanned reads remain read-only projections: the store returns all active tasks without any schedule block, the API groups nothing, and the client applies calendar-relative groups so labels remain consistent with the current Shanghai date. Capacity is a pure snapshot projection per date, with range requests capped to 31 dates.

The timeline range is a shared value object derived from the snapshot. Start/end are whole-hour aligned, always include the default 08:00–19:00 range, and expand for earlier/later availability, blackouts, blocks, or attempted conflict markers. Rendering, current-time position, drag coordinate conversion, and conflict position all consume this same range.

Adjustment previews are feature components fed by typed proposal moves. Routes/models still own no display strings; the Dashboard resolves block IDs to task titles and passes plain preview rows into the component. Model text must never be used as the source of before/after times.

## UI Component Strategy

Use mature accessible primitives instead of hand-implementing common interaction behavior:

- `shadcn/ui` as the project-owned component layer, with Radix primitives underneath for dialogs, menus, tabs, popovers, tooltips, focus management, and keyboard behavior.
- `lucide-react` for consistent icons rather than ad-hoc Unicode symbols in production controls.
- `React Hook Form` and `Zod` for later task/settings forms and runtime validation.
- Keep the Goalset visual language in local theme tokens and component variants; adopting a mature primitive layer does not mean accepting a generic visual template.

The schedule timeline, AI change preview, conflict proposal, and project progress visualizations remain feature components. They may use CSS grid and domain-specific layout code because their behavior depends on the fixed/flexible/floating task contract. They must still compose the shared Button, Badge, Dialog, Input, Tabs, and Toast components instead of recreating those primitives.

## Password Owner Authentication

The latest user decision supersedes the proposed Google OAuth migration. Goalset keeps the existing single-owner password flow and introduces no user registration, OAuth identity, account switching, or per-user data ownership.

- `AUTH_DISABLED=false` remains mandatory for the public Cloudflare Tunnel deployment.
- `OWNER_PASSWORD` and `AUTH_SECRET` stay only in ignored `.env.local`; their values must never enter code, task artifacts, logs, screenshots, or Git.
- A successful password check issues the existing HTTP-only owner JWT for the `personal` workspace. Anonymous pages redirect to `/login`, while anonymous protected APIs return `401`.
- Password changes require recreating the app container. Existing sessions remain valid unless `AUTH_SECRET` is also rotated; this password-only change intentionally preserves current sessions.
- The user-selected password is accepted as an explicit deployment choice even though it is weak. The safe follow-up is password rotation, not disabling authentication or weakening cookie/API protections.

## One-off and Recurring Task Creation

One-off versus recurring is not a second task-kind enum. A task with no recurrence rule is one-off; a task referenced by one validated recurrence rule is recurring. `fixed / flexible / floating` remains the independent scheduling constraint.

- Define one shared recurrence draft contract: `frequency`, optional `weekdays`, `startDate`, optional `endDate`, and `timezone`.
- Extend the normal schedule-create command with optional `recurrence`. The SQLite store writes the template task, initial block or unplanned state, recurrence rule, change set, and eligible reminders in one transaction. Existing callers that omit `recurrence` remain one-off and backward compatible.
- Manual creation defaults to “一次性”. Selecting “周期” reveals only the existing four frequencies: daily, workday, weekly, and selected weekdays, plus optional end date. The submit button itself is the user confirmation.
- Existing task-detail recurrence editing, single-occurrence skip/move/override, and lazy materialization remain the sole recurrence engine and exception model.

The natural-language plan adds a nullable recurrence draft plus a decision of `one_off`, `recurring`, or `uncertain`:

1. Deterministic parsing handles explicit Chinese recurrence phrases and emits a validated recurring draft.
2. Ambiguous phrases are sent to the configured cloud provider; without a working provider they return one concise clarification.
3. A recurring plan never writes immediately. The API returns a `recurrence_preview` containing normalized task and recurrence fields.
4. The Dashboard displays frequency, weekdays, start/end dates, start/deadline, and duration. Only explicit confirmation posts the shared schedule-create command.
5. The server revalidates the confirmed payload and uses rule scheduling mode for the first occurrence; recurrence confirmation does not implicitly authorize moving existing tasks.

Invalid combinations are rejected before mutation: selected-weekday frequency without weekdays, end before start, unsupported monthly/custom frequencies, fixed tasks without exact start time, non-15-minute duration/time, or a recurrence range that cannot include its start occurrence.

## Persistence and Deployment

Recommended initial technical shape:

- TypeScript + React/Next.js for the responsive Web/PWA.
- SQLite in WAL mode for durable tasks, recurring instances, audit records, reminders, and preferences on the single private host.
- A small Node worker for reminder dispatch, retries, recurrence materialization, and QQ connection lifecycle.
- A provider interface for cloud AI first, with secrets kept server-side.
- Docker Compose with a reverse proxy/HTTPS layer, private authentication, encrypted environment secrets, and scheduled database backups.

The production-shaped personal-host deployment uses a dedicated Cloudflare Tunnel for `goalset.codefromkarl.xyz`, leaving the Firefly root domain unchanged. `cloudflared` runs beside the Compose app with host networking, a narrowly mounted ignored credential, and the same host UID/GID that owns the credential. The Tunnel must stay stopped until `AUTH_DISABLED=false`, the app is healthy, and an online SQLite backup exists.

The application should be a single-user private service, but the data model can keep an explicit user/account boundary so QQ identity binding and future authentication do not leak into every domain table.

## Failure and Recovery Rules

- AI provider unavailable: Dashboard and manual task editing continue; AI commands show a truthful failure state.
- QQ unavailable: Website chat and Dashboard continue; inbound messages are not silently marked processed unless the command was durably recorded.
- Reminder failure: retry with a bounded policy and expose failure; never mark a task complete or reschedule it because a notification failed.
- Scheduling conflict: preserve the original schedule until a plan is auto-approved or explicitly confirmed.
- Undo: apply inverse operations with conflict checks; if later changes make a clean inverse impossible, show a recovery proposal instead of overwriting newer work.

## Technical Feasibility Gates

- Verify an official QQ Bot account can receive and reply to the intended C2C private messages in the available environment.
- Verify the permitted intent, sandbox/production flow, rate limits, message formats, and credential lifecycle.
- Verify the selected server can maintain the required connection or receive the required callback securely.
- Defer PWA phone/browser acceptance and Tailscale Serve unless the user explicitly re-enables PWA reminders.

## Current Local Slice

The local implementation follows this design without introducing a second component system: SQLite is the active store, the deterministic scheduler owns all placements, website/QQ commands share the structured provider boundary, and PWA/QQ reminders consume the outbox. The Web app and optional workers share one bind-mounted SQLite file with WAL, foreign keys, a bounded busy timeout, verified backup/restore, and an atomic reminder-claim test. The Dashboard now exposes weekly availability, temporary unavailable windows, project health/progress, recurrence creation and single-occurrence overrides, visible reminder failures, explicit default-duration preferences, and exact-time AI rescheduling with confirmation when elastic blocks are affected.

Recurring instances use `<templateTaskId>@<date>` task identities and are materialized lazily when a date is read. A materialized occurrence is scheduled through the same scheduler; an unavailable slot remains an unplanned task instead of being silently dropped. Updating an occurrence changes only that occurrence, while deleting the parent rule removes generated instances and their outbox rows.

The remaining external gates are intentionally isolated from the core: valid cloud AI credentials and official QQ C2C account/intent/sandbox access. A real browser push subscription is deferred while QQ-only mode is selected. The application remains usable through manual scheduling and website AI when the QQ channel is unavailable.
