# Schedule Domain

## 1. Scope / Trigger

The deterministic schedule domain owns candidate generation and conflict classification for fixed, flexible, and floating tasks. It must remain independent from React, AI providers, QQ channels, and database adapters.

## 2. Signatures

```ts
findScheduleProposal(
  task: ScheduleTask,
  context: ScheduleContext,
): ScheduleProposal

type SchedulingMode = "rules" | "optimize"

scheduleTask(
  taskId: string,
  date: string,
  options: { mode: SchedulingMode; startMinutes?: number; confirm?: boolean },
): Promise<ScheduleExistingTaskResult>

arrangeUnplanned(date: string): Promise<ArrangeUnplannedResult>
closeDay(date: string, action: "unplan" | "move_tomorrow"): Promise<DailyCloseResult>
calculateDailyCapacity(snapshot: ScheduleSnapshot): DailyCapacity
deriveTimelineRange(snapshot: ScheduleSnapshot): TimelineRange
groupUnplannedTasks(tasks: ScheduleTask[], today: string): UnplannedGroup[]

placementToBlock(
  task: ScheduleTask,
  placement: SchedulePlacement,
): ScheduledBlock
```

The current implementation lives in `web/src/features/schedule/domain/scheduler.ts`; shared types live in `domain/types.ts`.

## 3. Contracts

- `ScheduleTask.estimatedMinutes` is a positive multiple of 15.
- `ScheduleTask.kind` is `fixed`, `flexible`, or `floating`.
- Fixed tasks require `preferredStartMinutes` and must have `movable: false`.
- `ScheduleContext` contains the target date, availability windows, unavailable windows, existing blocks, and an optional 15-minute-aligned buffer.
- `ScheduleContext.mode` defaults to `rules`. Rules mode searches only empty safe slots and never relocates existing blocks.
- `optimize` is an explicit, one-shot authorization. It may produce moves only for movable tasks; `needs_confirmation` remains non-mutating until a confirmed store command applies it.
- `ScheduledBlock.priority` and `ScheduledBlock.projectId` are optional scoring metadata carried by the shared snapshot contract; they never weaken hard constraints.
- `ScheduleProposal.decision` is `auto`, `needs_confirmation`, `no_slot`, or `needs_information`.
- A `needs_confirmation` proposal may include `placement` and `movedBlockIds`, but it never mutates the input context.
- `placementToBlock` creates a deterministic ID from task ID, date, and start minute.
- After hard-constraint filtering, `rules` ordering is exact start, otherwise closest to an explicit preferred start, otherwise chronological. Only `optimize` mode scores deadline slack, priority, fragmentation, and same-project continuity.
- `insertTask(..., { mode: "rules" })` persists a valid task even when the proposal is `no_slot`; the snapshot then exposes that task without a block so the UI can render it as unplanned.
- `scheduleTask(..., { mode: "rules" })` requires an explicit 15-minute-aligned `startMinutes`. `mode: "optimize"` may omit it and ask the deterministic scheduler for a candidate.
- `arrangeUnplanned` ranks priority, deadline, title, and ID; it simulates rules-only placement against a growing working block set and persists all successful blocks in one transaction/ChangeSet.
- `closeDay` affects incomplete flexible/floating tasks only. It removes their blocks and optionally changes their date to the next UTC calendar key; fixed and done tasks remain untouched.
- Timeline range starts from 08:00–19:00 and expands to whole hours for earlier/later availability, blackouts, blocks, or attempted conflict markers. Labels, blocks, current time, drag coordinates, and conflict positions consume the same range.
- Capacity is a pure 15-minute-slot projection. Missing availability is `unknown`; capacity deficit or deadline risk is `impossible`; at most 60 minutes/configured-buffer margin is `tight`; otherwise it is `healthy`.
- Cross-date unplanned grouping is relative to the Shanghai today key and emits overdue/today/tomorrow/this-week/later without mutating task dates.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Duration is zero, negative, or not a 15-minute multiple | Throw `ScheduleValidationError` with `invalid_duration`. |
| Time or buffer is outside the day or not 15-minute aligned | Throw `ScheduleValidationError` with `invalid_time` or `invalid_buffer`. |
| Fixed task has no exact start | Throw `missing_fixed_start`. |
| Task date differs from context date | Return `needs_information`; do not mutate. |
| Empty candidate satisfies availability, blackout, buffer, and deadline | Return `auto`. |
| Only movable blocks prevent a candidate in `rules` mode | Return `no_slot`; keep the task unplanned and do not move the blockers. |
| Only movable blocks prevent a candidate in explicit `optimize` mode | Return `needs_confirmation` with deterministic move details. |
| Fixed blocks, blackouts, or hard deadlines leave no candidate | Return `no_slot`; never move a fixed block. |
| Existing unplanned task is scheduled with `rules` but no `startMinutes` | Reject the request as invalid; manual placement must name an exact time. |
| Same-project block metadata is present in `optimize` mode | Prefer the nearest safe contiguous slot after hard constraints and buffer checks. |
| Normal `rules` mode has no preferred time | Preserve chronological ordering regardless of priority or project metadata. |

## 5. Good / Base / Bad Cases

- Good: explicit optimize mode may group a flexible task beside same-project work while hard constraints remain valid.
- Good: a normal insertion with no safe slot persists an unplanned task, then an explicit manual placement or AI-optimization request schedules it later.
- Base: a task with no preferred start scans available slots in chronological order.
- Bad: ordinary task creation silently upgrades itself to optimization and moves elastic blocks because the user mentioned a deadline.
- Bad: a soft scoring preference overrides a fixed block/deadline, or a project ID is inferred from display text instead of the shared task/block contract.

## 6. Tests Required

The scheduler test suite must assert:

- fixed-block overlap and buffer behavior;
- fixed-task conflict refusal;
- movable-block confirmation proposals;
- hard-deadline rejection;
- unavailable-window skipping;
- invalid duration rejection;
- deterministic placement IDs.
- exact reschedule targets are not replaced by another free slot;
- same-project context changes candidate order while unrelated/missing project context preserves chronological order;
- recurrence date keys remain stable across DST calendar boundaries and leap days.
- rules-mode insertion never moves an existing elastic task and persists `no_slot` work as task-without-block;
- explicit optimize mode may return deterministic moves but does not apply them before confirmation;
- manual unplanned placement validates the requested 15-minute start and preserves the task identity.
- batch arrange and daily close restore the complete prior block/date state through one undo.
- dynamic ranges include early/late boundaries, capacity statuses expose exact minutes, and cross-date groups remain calendar-stable.

Future tests should add randomized/property coverage for multi-window availability and concurrent idempotent command handling.

## 7. Wrong vs Correct

### Wrong

```ts
// Ordinary task capture implicitly authorizes relocation.
findScheduleProposal(task, { ...context, mode: "optimize" });
```

### Correct

```ts
const proposal = findScheduleProposal(task, { ...context, mode: "rules" });
// If no safe slot exists, persist the task without a block. Only a later,
// explicit optimize command may propose relocations, and confirmation applies them.
```
