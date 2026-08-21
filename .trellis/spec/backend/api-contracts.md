# Schedule API Contracts

## 1. Scope / Trigger

The first Next App Router API boundary is `/api/schedule`. It normalizes schedule snapshots for the Dashboard and routes task insertion through the deterministic scheduling core. This contract exists so the SQLite repository, website chat, and QQ adapter cannot invent separate payload shapes.

## 2. Signatures

```text
GET  /api/schedule?date=YYYY-MM-DD
POST /api/schedule
POST /api/tasks/:id/schedule
POST /api/schedule/arrange
POST /api/schedule/daily-close
GET  /api/tasks/unplanned
GET  /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
```

The current implementation is in `web/src/app/api/schedule/route.ts` and `web/src/app/api/tasks/[id]/schedule/route.ts`. The active local deployment uses the SQLite/LibSQL adapter with the in-memory adapter retained only as a no-database development fallback.

## 3. Contracts

### GET request

- Query field: `date`, required, format `YYYY-MM-DD`.
- Response `200`: `ScheduleSnapshot` with `date`, `tasks`, `blocks`, `availability`, `unavailable`, and `bufferMinutes`.

### POST request

```json
{
  "task": {
    "id": "string",
    "title": "string",
    "date": "YYYY-MM-DD",
    "kind": "fixed | flexible | floating",
    "priority": "low | normal | high",
    "status": "todo | doing | blocked | done",
    "estimatedMinutes": "positive 15-minute multiple",
    "movable": "boolean",
    "preferredStartMinutes": "optional day minute",
    "deadlineMinutes": "optional day minute",
    "projectId": "optional string"
  }
}
```

- `201` with `proposal.decision = auto`: task was placed in an empty safe slot and the response contains the updated SQLite snapshot plus an auditable `changeSetId`.
- `201` with `proposal.decision = no_slot`: the valid task was persisted without a schedule block and appears as unplanned; no existing block moved.
- `422`: required scheduling information is inconsistent; the original snapshot remains unchanged.
- `400`: request JSON or fields fail runtime validation.

### POST existing unplanned task

```json
{
  "date": "YYYY-MM-DD",
  "mode": "rules | optimize",
  "startMinutes": "required 15-minute value for rules; optional for optimize",
  "confirm": "optional boolean"
}
```

- `200`: creates one schedule block for the existing task and returns `{ taskId, date, proposal, snapshot, changeSetId }`.
- `409`: explicit optimize mode found a plan that moves elastic tasks; nothing changes until the same command is sent with `confirm: true`.
- `422`: the exact drop/click target is unsafe or no optimized candidate exists; the task remains unplanned.
- `400`: rules mode omitted `startMinutes`, or date/time/mode failed Zod validation.

### POST batch rules and daily close

- `POST /api/schedule/arrange` accepts `{ date }` and returns `{ arrangedTaskIds, remainingTaskIds, snapshot, changeSetId? }`. It fills only empty rules-safe slots, never moves existing blocks, and records all successful placements in one reversible ChangeSet.
- `POST /api/schedule/daily-close` accepts `{ date, action: "unplan" | "move_tomorrow" }` and returns `{ date, targetDate, action, affectedTaskIds, snapshot, changeSetId? }`.
- Daily close affects only incomplete non-fixed tasks. `unplan` deletes their blocks but retains their date; `move_tomorrow` deletes blocks and changes their date by one calendar day. Fixed tasks are unchanged.
- An empty batch returns `200` without a ChangeSet or hidden mutation.

### Read-only planning projections

- `GET /api/tasks/unplanned` returns every active task without any schedule block as `{ tasks: ScheduleTask[] }`; ordering is priority, deadline, title, then stable ID. Group labels remain a client projection relative to the Shanghai current date.
- `GET /api/capacity` accepts an inclusive 1–31 day range and returns `{ days: DailyCapacity[], totals }`.
- Each capacity day includes unfinished/scheduled/unplanned/free/slack/deficit minutes, deadline risk count, `healthy | tight | impossible | unknown`, and one deterministic reason. The projection never invokes AI or applies a schedule change.

All payloads are decoded from `unknown` with the shared Zod contract in `src/features/schedule/data/contract.ts`. The client validates the returned snapshot again before using it for display.

## 4. Validation & Error Matrix

| Condition | HTTP behavior |
| --- | --- |
| Missing or malformed `date` | `400 { error: { code: "INVALID_REQUEST", message } }` |
| Malformed JSON or missing task fields | `400` with the same stable error envelope |
| Non-15-minute duration/time | `400`; do not invoke the scheduler |
| Empty safe slot | `201` and apply only the domain-approved auto placement |
| Normal insert has no empty safe slot | `201`; persist the task without a block and return `no_slot` |
| Rules-mode click/drop conflicts | `422`; preserve the unplanned task and every existing block |
| Explicit optimize must move elastic work | `409`; return a preview and require `confirm: true` |
| Fixed block/deadline prevents placement | `422`; never move the fixed block |
| Batch rules queue has partial capacity | `200`; place the safe prefix/candidates, return leftovers, and create one ChangeSet |
| Daily close includes fixed/done tasks | Exclude them from `affectedTaskIds`; preserve their rows and blocks |
| Any write in batch/daily-close fails | Roll back the whole transaction and return `409` |
| Capacity range is reversed or exceeds 31 days | `400 INVALID_REQUEST` |
| Cross-date/capacity storage read fails | `503` with a stable error envelope; never return an empty success |
| Client cannot parse a successful snapshot | Treat response as unavailable; do not render it as an empty schedule |

## 5. Good / Base / Bad Cases

- Good: the API validates a task, calls `findScheduleProposal`, and returns a typed proposal without allowing the request body to set a start block directly.
- Base: the active Compose deployment reads and writes the shared SQLite file; the in-memory snapshot is used only when `DATABASE_URL` is intentionally absent for local development.
- Bad: returning `422` without persisting a valid no-slot task, letting a drag handler edit client state directly, or treating ordinary text as optimize authorization.
- Bad: looping over HTTP mutations from the browser for “arrange all”, or creating one ChangeSet per task in a user-visible batch.

## 6. Tests Required

- Route contract tests for valid GET, invalid date, invalid POST, auto placement, confirmation response, and no-slot response.
- Assert no-slot `POST /api/schedule` persists exactly one task without a block and moves no existing block.
- Assert click/drop `422` leaves the task unplanned and optimize `409` leaves every block unchanged until confirmation.
- Assert the client parser rejects missing or malformed snapshot fields.
- Assert batch arrange uses priority/deadline/title order, moves no existing block, retains leftovers, and one undo removes every inserted batch block without deleting tasks.
- Assert daily close preserves fixed/done tasks, both actions are reversible, and calendar dates advance without local-time drift.
- Assert all-date unplanned excludes scheduled/done tasks and capacity returns deterministic healthy/tight/impossible/unknown states for bounded date ranges.
- Repository integration tests run against a temporary SQLite file and must cover transaction rollback, reminder foreign-key ordering, JSON/timestamp mappings, and atomic claims across two clients.

## 8. Related mutation contracts

- `PATCH /api/tasks/:id` accepts `title`, `status`, `priority`, or `notes`; at least one field is required and the response is `{ snapshot }`.
- `DELETE /api/tasks/:id` removes reminder outbox rows, schedule blocks, and the task in one transaction before returning `{ snapshot }`.
- `POST /api/schedule/confirm` applies a `needs_confirmation` proposal and returns `{ proposal, snapshot, changeSetId }`.
- `POST /api/schedule/undo` accepts a UUID `changeSetId` and returns `{ snapshot }`; an already undone or unknown change returns `404`.
- `POST /api/ai/command` accepts `{ message, date, optimize? }`; `optimize` defaults to false and only the dedicated Web action may set it. It returns `clarification`, `applied`, `unplanned`, or `proposal` and never mutates on a clarification or failed provider call.
- `POST /api/ai/command` also accepts structured `update_task` intents for status, priority, or notes and returns `{ kind: "updated", taskId, snapshot }`; `reschedule_task` returns `rescheduled` for an exact safe move or `409 reschedule_proposal` when elastic blocks must move. Creation/reschedule intents may return a target date on relative-date requests such as “明天”.
- `POST /api/tasks/:id/reschedule` accepts `{ date, startMinutes, confirm?, optimize? }`; ordinary requests use rules mode, while explicit optimize may preview elastic moves. It preserves the original block on `409` and writes a reversible ChangeSet on success.
- QQ optimization requires the strict `优化日程` or `AI 重排` prefix; text elsewhere in a message never grants optimize mode.
- `POST /api/recurrence` creates a daily, weekly, workday, or selected-weekday rule for an owned task; `GET /api/recurrence/:id?from=YYYY-MM-DD&to=YYYY-MM-DD` applies single-occurrence overrides; `DELETE /api/recurrence/:id` removes the rule, overrides, and generated occurrence tasks without deleting the base task.
- `POST /api/recurrence/:id/overrides` accepts `skip`, `move`, or `override`; `skip` removes the occurrence from the returned list while other actions remain attached as explicit override data for the materializer.
- `GET /api/recurrence?taskId=...` returns the owned rules used by the task detail editor.
- `GET /api/availability` returns seven weekly rules and up to thirty temporary unavailable windows. `PUT /api/availability` replaces the seven weekday rules; `POST` and `DELETE?id=...` manage one-off unavailable windows.
- `GET /api/reminders` returns recent reminder status, channel, kind, failure, and timestamps. `POST /api/reminders/:id/retry` requeues only a failed reminder.
- `PUT /api/preferences` supports `bufferMinutes`, `defaultDurationMinutes`, and `timezone`; `DELETE /api/preferences?key=...` clears exactly one preference, never the whole workspace.
- `GET /api/status` returns integration flags plus `workers[]` heartbeat records when SQLite is configured; a worker record includes `workerName`, `status`, `lastRunAt`, `lastSuccessAt`, and `lastError`.
- Auth session cookies are `Secure` when the request is HTTPS (or `AUTH_COOKIE_SECURE=true`) and remain usable over a private LAN HTTP deployment when the override is not enabled; public access must use HTTPS.
- `AUTH_DISABLED=true` is an explicit single-user private-network bypass: the proxy allows all requests, `/login` redirects to `/`, and `/api/status` reports `authDisabled: true`. Never use this mode on a public or untrusted network because every reachable client receives owner permissions.
- `GET /api/change-sets/export?format=csv` downloads up to 1000 workspace ChangeSets with parsed intent and before/after state; the default format is JSON.
- `GET /api/preferences/suggestions` returns a suggestion only when at least three non-seed accepted tasks share a duration; applying it still requires an explicit user action in Settings.

## 7. Wrong vs Correct

### Wrong

```ts
const body = await request.json();
await db.blocks.insert(body.task); // bypasses validation and scheduling
```

### Correct

```ts
const parsed = scheduleCommandSchema.safeParse(await request.json());
if (!parsed.success) return invalidRequest();
const result = await scheduleStore.insertTask(parsed.data.task, { mode: "rules" });
return responseForProposal(result);
```

```ts
// Correct: one store transaction owns the batch and one ChangeSet.
const result = await scheduleStore.arrangeUnplanned(parsed.data.date);
return NextResponse.json(result);
```
