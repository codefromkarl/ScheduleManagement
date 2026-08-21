# Component Guidelines

## Scope / Trigger

This project uses a project-owned UI component layer for common interaction behavior and feature-owned components for Goalset-specific scheduling behavior. This convention was established while building the first Dashboard slice.

## Component Layers

- `web/src/components/ui/` contains reusable primitives such as `Button`, `Input`, and `Badge`. These are based on shadcn/ui conventions and Radix primitives, and are readable project source rather than an opaque runtime package.
- `web/src/components/` contains cross-feature shell and product components.
- `web/src/features/<feature>/` contains domain models and feature-specific UI.
- The schedule timeline, task blocks, conflict preview, and progress visualizations are feature components. Their time-grid behavior may be custom, but their buttons, inputs, badges, dialogs, menus, and tooltips must reuse `components/ui`.

## Signatures

Common primitives expose typed props and class composition:

```tsx
<Button variant="soft" size="sm" onClick={openAssistant}>
  开始对话
</Button>
<Input aria-label="告诉 AI 一个临时任务" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
<Badge>在线</Badge>
```

Feature state uses explicit domain types rather than display-only strings:

```ts
type ScheduleKind = "fixed" | "flexible" | "floating";
type TaskStatus = "todo" | "doing" | "blocked" | "done";
```

## Contracts

- Every interactive control must use a native semantic element or a shared primitive that preserves the same semantics.
- Icon-only controls require an accessible `aria-label`; visible text controls should not rely on an icon or color alone.
- Shared primitives accept `className` and merge it through `cn()`; consumers must not duplicate primitive behavior in page CSS.
- Feature components own domain layout and state transitions, but they do not access database schemas or provider payloads directly.
- Dates and schedule values crossing a boundary must use explicit typed fields; do not pass formatted display strings as domain state.
- Desktop week columns must be derived from the seven date-keyed schedule snapshots; demo week labels are not an acceptable success state once the API is available.
- Settings, recurrence, notification, and project controls should extend the existing `Button`, `Input`, `Badge`, and native semantic form controls; do not add a second UI kit for these panels.
- Preference suggestions are advisory UI only: render an explicit “采用” action and never mutate the stored preference from a read request.
- The unplanned tray is derived from snapshot tasks without matching blocks. Native drag-and-drop is a desktop enhancement; every task must also expose the keyboard/mobile “选择时间” path.
- Drag coordinates snap to 15 minutes and call the typed existing-task schedule API. A visual drop must never directly edit schedule-item state or silently choose a different time after a conflict.
- Web AI optimization is a one-command authorization activated only by the dedicated “AI 优化日程” control; ordinary natural-language capture always uses rules mode.
- Scheduled flexible/floating blocks may emit a drag payload; fixed blocks never do. Every scheduled task also exposes an exact-time input in the task-detail Sheet.
- While the API snapshot is loading, durable actions derive from empty state, not demo tasks. Demo items may appear only after a truthful API failure state.
- Confirmation handlers receive the confirmed action value directly. Do not re-read nullable dialog state after Radix closes the dialog, because `onOpenChange(false)` may clear it before asynchronous work begins.
- Detailed optimize previews resolve task titles from the proposal snapshot and render deterministic `from -> to` rows. Provider prose is summary text only, never the source of movement times.
- Capacity and all-date unplanned data live in the existing Activity Sheet to avoid a second planning page; selecting a group item changes the Dashboard date and closes the Sheet.
- The Dashboard is an execution surface, not a feature inventory: render the selected day or week timetable, unplanned work that needs a decision, and exception/risk entrypoints before history or diagnostics. Do not add a separate next-task card or completed/scheduled summary strip above the calendar.
- Desktop week mode is a planning workspace: render Monday through Sunday as seven real schedule columns on one shared dynamic vertical time range, then use the wide-screen planning rail for actionable capacity, cross-date unplanned work, selected-date risk, and recent changes. Each task must appear at its actual date/time; the week surface is not a date selector for a single-day timeline.
- Mobile day mode is an execution workspace: default to today, keep the selected date and day timeline primary, and expose previous day, next day, and an explicit native date picker. Selecting a date preserves day mode until the user explicitly switches views.
- Task details expose `自动`, `强制提醒`, and `不提醒` under advanced settings. The control persists only `reminderPolicy`; it must never rewrite priority, kind, or schedule constraints, and unconfigured-channel copy must state that the saved policy activates after configuration.
- Reminder settings distinguish VAPID configuration, subscribed-device count, provider acceptance, device service-worker receipt, and transport failure. Never label permission grant or `sentAt` alone as successful device delivery.
- PWA test actions remain disabled until credentials and at least one device subscription exist. The client waits beyond the worker polling interval and reports PushManager/secure-context failures truthfully.
- Reminder settings render only channels selected by `GET /api/status.reminderChannels`. In QQ-only mode they hide PWA activation/test actions, state when QQ credentials are missing, and label `sentAt` as “QQ API 已接受，请确认客户端收到” rather than a delivery receipt.
- AstrBot status belongs to the integration boundary, not the scheduling UI. Do not expose its Agent, future-task, plugin-market, or model configuration as Goalset task controls.
- Week timetable headers may select the working date, but the body always keeps all seven day columns visible. Clicking a task opens the existing detail Sheet; desktop drag/drop passes the target column date plus a 15-minute snapped time through the existing validated reschedule API, including cross-day moves.
- The seven weekly snapshots share one range computed from the minimum derived start and maximum derived end. A successful mutation must refresh the week projection even when the selected date does not change; clicking an already selected weekday must not leave the page in a permanent loading state.
- Weekly task blocks persist only a readable title and explicit `HH:mm–HH:mm` range. Kind stays encoded by the existing border/background tone; the full title, kind, status, project, duration, and time range live in the button's accessible name plus its hover/focus disclosure and task-detail Sheet.
- Weekly tracks render subtle half-hour lines between the existing hourly lines. The today track renders a labeled `现在 HH:mm` marker; live clock state must use `useSyncExternalStore` with a stable server snapshot so time-dependent text never causes hydration mismatch.
- Responsive default view uses the request User-Agent as the `useSyncExternalStore` server snapshot: phone/tablet requests render day mode on the server, desktop requests render week mode, and hydration reads the live media query. Do not render a complete desktop workspace on a phone request and replace it after hydration.
- Initial schedule, capacity, and all-date unplanned state come from the typed `/api/dashboard` range payload. A date switch within the loaded week reuses that snapshot; a mutation explicitly increments the Dashboard revision instead of depending on task-count changes.
- Drag-over feedback uses the same coordinate-to-minute projection as drop. It shows the exact 15-minute-snapped `HH:mm` target line without mutating local items; only the existing schedule/reschedule API response may move a task or show a conflict marker.
- Desktop unplanned drag sources live in the compact Dashboard entry outside modal layers. Render at most the three ranked tasks there; the modal Sheet owns the complete list and exact/batch/AI actions, but its rows must not claim draggable behavior while the overlay blocks timeline hit-testing.
- Both scheduled and unplanned drag payloads carry task ID plus estimated duration. The target renders a neutral start–end ghost with the corresponding height and “release to validate” copy; it must not imply that client preview has passed server constraints.
- Rejected drops render a narrow attempted-time marker and keep the blocking task visible. The complete API reason remains in accessible marker text and the result Toast.
- Natural-language entry is an explicit disclosure. Ordinary input may parse intent but must describe placement as rule scheduling; only the separate `AI 优化日程` control may set optimization intent.
- New-task and task-detail surfaces use progressive disclosure: title plus duration are the fast path, while task kind, priority, recurrence, notes, occurrence overrides, and deletion remain under clearly labeled advanced controls.
- Summary values must come from the selected `ScheduleSnapshot`. Free minutes remove unavailable windows, scheduled blocks, and configured buffers; never use a fixed eight-hour constant or label free capacity as “待安排”.
- Tasks without a block remain visible in a `待安排` tray. Desktop may add drag-to-timeline, but mobile and keyboard users must also have explicit time-selection and AI-optimization buttons.
- Transient UI must use the project-owned Radix wrappers in `components/ui`: `DropdownMenu` for account actions, `Popover` for search/notifications, `Sheet` for settings/editing/navigation, `ConfirmDialog` for destructive decisions, and `ToastRegion` for non-blocking feedback.
- Topbar layers are controlled by one `TopLayer` union and are mutually exclusive. Main editing/navigation surfaces are controlled by one `ActiveSurface` union; adding another independent `showX` boolean for a peer surface is forbidden.
- Popovers, menus, sheets, and confirmation dialogs must close on Escape and outside interaction where appropriate, restore focus to the actual trigger, expose the correct role and `aria-expanded`, and use a Portal-backed stacking layer.
- Desktop sidebar supports 250px expanded and 76px navigation-rail modes. Its state is persisted under `goalset:sidebar-collapsed` and read with `useSyncExternalStore`; mobile hides the rail but exposes equivalent project/settings actions through the navigation Sheet.
- Search has no invisible state: closing the search Popover clears its query; if a future design preserves a query, it must render a visible removable filter chip.
- Success/status messages use the toast lifecycle. Schedule-changing proposals remain persistent inline alerts until confirmed or cancelled; they must not be converted into auto-expiring toasts.
- The default Dashboard content budget is `toolbar → optional unplanned shortcut → calendar`. Full unplanned lists, capacity, activity history, and daily-close actions belong in Sheets or menus, not stacked above the calendar.
- The Dashboard exposes one primary `添加任务` action. Manual entry and natural-language entry are modes of the same Sheet, not peer buttons or simultaneous panels.
- Hide redundant/normal information: do not render a next-task card or completed/scheduled summary strip, do not render a positive “日程无风险” badge, hide the project selector when only one project exists, and omit database/provider implementation text while services are healthy.
- Mobile dense-state acceptance requires the calendar to begin within the first 450 CSS pixels at 390px width; desktop dense-state acceptance requires it to begin within roughly 450px. Adding another default block above the calendar must preserve this budget or displace an existing block.
- `待安排 N 项` on the Dashboard is a compact shortcut only. The unplanned Sheet owns item actions, batch arrangement, exact time selection, and AI optimization. `今日收尾` lives in the calendar overflow menu; capacity/cross-date groups/change history live in the activity Sheet.
- Toasts that expose `撤销` remain open for 12 seconds; ordinary status toasts use the shorter default duration. Tests that need undo must not detour through unrelated Sheets before invoking it.

## Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| A button triggers a mutation | Use `Button`, expose disabled/pending state, and show a truthful result or error. |
| An icon has no visible label | Add `aria-label` and a visible focus state. |
| A client component reads viewport/browser state | Use `useSyncExternalStore` or an equivalent subscription; do not synchronously call `setState` in an effect. |
| A feature needs a new primitive | Search `components/ui` first; add or extend a shared primitive before duplicating behavior. |
| A sample/demo state is not persisted | Label it as demo or pending integration; never imply that a successful local state update reached a backend. |
| A dropped/clicked exact time conflicts | Keep the task in the unplanned tray and display the API proposal reason. |
| A touch or keyboard user cannot drag | Provide the same exact-time input and confirmation action without drag. |
| Confirmation dialog closes before async work starts | Pass the action snapshot into the handler; do not look it up from cleared component state. |
| A normal task has no safe slot | Keep it visible in the unplanned tray; do not hide it, report success as scheduled, or silently move another task. |
| The user opens natural-language entry | Focus the command input and expose whether the one-shot AI optimization authorization is off or on. |
| Mobile viewport is 390px wide | Day mode has no horizontal page overflow; primary icon/calendar controls use approximately 44px hit areas and the day timeline remains the primary schedule surface. |
| Mobile user selects another date | Fetch the selected calendar key, preserve day mode, and keep previous/next/date-picker/today controls touch accessible. |
| Mobile request hydrates at 390px | Server and first client render both use day mode; no desktop-to-mobile layout replacement or hydration warning occurs. |
| Desktop defaults to week mode | Render one shared-time Monday-to-Sunday timetable plus the planning rail; each risk/unplanned summary must lead to the existing Sheet or selected date. |
| Weekly task receives hover or keyboard focus | Keep title/time visible in the block and expose full title, kind, status, project, duration, and time in the disclosure/accessibility tree. |
| Current time is inside today's dynamic range | Show one labeled current-time line after hydration; server HTML must not embed a different wall-clock value. |
| A task is dragged over a day track | Show the snapped 15-minute target line/time; do not move the block before the validated API response. |
| Desktop has unplanned work | Expose the top three draggable sources in the compact entry outside the Sheet; keep `选择时间` as the keyboard/mobile equivalent. |
| Unplanned Sheet is open | Rows are action/list content, not draggable sources; the modal overlay may not be presented as a reachable timeline drop surface. |
| Exact drop is rejected | Keep the source placement, show a narrow attempted-time marker without covering the blocker, and expose the full reason in Toast/accessibility text. |
| QQ is not configured | Allow task reminder policy edits and show truthful deferred-effect copy; do not disable unrelated task editing. |
| QQ-only mode retains old PWA credentials or heartbeats | Hide PWA controls and stale PWA worker health; do not imply PWA is an active fallback. |
| Push provider accepted but no service-worker receipt exists | Show “等待设备回执”, not “设备已收到”. |
| Browser PushManager rejects after permission grant | Show the Push Service error and keep device count unchanged. |
| Avatar/notification/search opens | At most one topbar layer exists; outside click and Escape close it and focus returns to its trigger. |
| Settings/new task/quick capture/task detail opens | Render one modal Sheet, lock background scroll, focus its first control, and restore focus to the opening control on close. |
| Sidebar collapse changes | Persist the state, update the accessible label, keep project/settings controls keyboard reachable, and restore the same width after reload. |
| Destructive task/project action starts | Render `role="alertdialog"`; Escape/cancel returns focus to the destructive trigger and no mutation occurs. |
| A normal mutation succeeds | Show a time-bounded Toast; do not leave a permanent success banner in page flow. |
| Dense mobile state has scheduled and unplanned work | Calendar starts at or before 450px, the detailed unplanned list is absent from page flow, and there is exactly one add-task CTA. |
| No risks exist | Omit positive or empty-state containers above the calendar. |
| Rules/natural task creation is opened | One `添加任务` Sheet exposes `快速填写` and `一句话输入` tabs and keeps only one mode mounted as the active form. |
| Normal data/AI services are healthy | Do not render SQLite/provider/worker diagnostics on the calendar; show diagnostics only for loading/failure or inside settings/activity. |

## Good / Base / Bad Cases

- Good: a schedule card owns its timeline placement while using `Button` for “today”, “undo”, and confirmation actions.
- Good: desktop week mode shows two tasks on different dates in their corresponding timetable columns while the compact unplanned entry opens the existing `选择时间` and `AI 优化` actions.
- Good: a 30-minute weekly block shows `设计评审` and `14:00–14:30`; focus reveals the complete project/status metadata without shrinking the persistent copy.
- Good: one compact `待安排 2 项` row exposes two draggable chips on desktop, hides them on mobile, and keeps the full Sheet action-oriented.
- Good: `topLayer` changes from `profile` to `notifications`, so the account menu closes before the notification Popover opens.
- Good: mobile navigation and desktop settings open the same `ActiveSurface="settings"` Sheet and expose the same project capabilities.
- Good: two unplanned tasks render one 52–54px shortcut above the calendar; clicking `处理` opens the full action list in a Sheet.
- Good: daily-close actions remain available under `更多日程操作` without consuming page height all day.
- Base: a static section uses semantic HTML and local layout classes without introducing a new abstraction for a one-off visual.
- Bad: four permanent stat cards, a duplicate “focus list”, and a permanent AI assistant panel all repeat data already visible on the timeline.
- Bad: a `div` with click handlers reimplements a dialog, menu, or button, or a page directly casts an untyped AI payload.
- Bad: `showProfile`, `showNotifications`, `showSettings`, and `showTaskForm` are independent booleans that permit overlapping surfaces.
- Bad: closing a search input hides the only indication that `searchQuery` is still filtering the calendar.
- Bad: repeating the unplanned count in summary, a full tray, and a right-side attention card.
- Bad: showing both `一句话添加` and `新建任务` as primary Dashboard actions when they write through the same task workflow.
- Bad: removing a task from the tray on `drop` before the server returns a validated snapshot, or keeping optimize mode active for later commands.
- Bad: rendering kind, status, project, duration, and title as multiple 7–9px rows inside every narrow weekly block, or calculating drag preview with a different rounding rule than drop.
- Bad: calling `Date.now()` / `new Date()` directly in server-rendered current-time markup, which can produce a hydration mismatch before the client clock is available.
- Bad: a `draggable` row lives behind a modal overlay and disappears when the modal closes, leaving no pointer path from source to timeline.

## Tests Required

- Run `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` for every UI slice.
- Add component or browser assertions for keyboard activation, accessible names, focus-visible states, and mobile/desktop layout where the component is interactive.
- For schedule components, assert fixed blocks are not moved by local interactions and that view changes preserve the underlying task identity.
- For the unplanned tray, assert the first three priority/deadline-ranked tasks render, exact-time placement consumes the returned snapshot, invalid placement remains visible, and mobile can complete the flow without drag.
- Playwright must cover batch undo, scheduled drag/click reschedule, visible rejected-target feedback, daily-close confirmation/undo, and 390px overflow against the isolated E2E database.
- Planning projection coverage must include 07:00/22:00 timeline expansion, overdue/today/tomorrow grouping, capacity presence, and concrete optimization preview rows.
- For the focused Dashboard, verify desktop Monday-to-Sunday timetable rendering, tasks on multiple dates concurrently, 390px day-mode no-overflow, quick-capture focus, collapsed advanced fields, unplanned manual placement, explicit optimization confirmation, and truthful free-time summaries.
- For weekly readability, assert persistent block text is title plus start–end time, full metadata is present in `aria-label`/hover-focus disclosure, half-hour guides render, a fixed client clock produces the exact current-time label without hydration errors, and drag-over displays the expected 15-minute target before drop.
- For unplanned desktop drag, use Playwright's real pointer `dragTo` from the compact chip into another visible date column, assert the Sheet row has no draggable/grip affordance, and verify target-date task/block persistence through the API.
- Verify the desktop planning rail reuses the typed capacity/unplanned projections, mobile date selection preserves day mode, and task-detail reminder policy survives an API round trip without live QQ credentials.
- Assert initial core reads use only the typed Dashboard endpoint, production mobile rendering has no layout shift from a desktop default, and a same-week date switch does not refetch the range.
- For interaction infrastructure, verify outside click, Escape, role/ARIA state, one-layer mutual exclusion, focus entry/return, sidebar 250→76 persistence across reload, mobile navigation capability parity, Sheet background scroll lock, AlertDialog cancellation, and Toast success feedback.
- For content density, seed scheduled work on multiple dates plus completed, blocked, unplanned, and changed work; assert one add CTA, no next-task or completed/scheduled summary blocks, no full unplanned tray in page flow, no healthy implementation status, and calendar top <= 450px at 390px.

## Wrong vs Correct

### Wrong

```tsx
<div className="icon-button" onClick={undo}>↶</div>
```

### Correct

```tsx
<Button variant="ghost" size="icon" aria-label="撤销调整" onClick={undo}>
  <Undo2 size={15} />
</Button>
```

## Design Decision: Mature Primitives, Custom Domain Surface

We use shadcn/ui/Radix-style primitives for common behavior because keyboard navigation, focus management, and ARIA semantics are easy to get subtly wrong. We keep the calendar timeline and AI scheduling preview custom because they encode Goalset's fixed/flexible/floating semantics and 15-minute scheduling grid. A generic calendar template must not dictate those domain rules.

## Design Decision: One Actionable Schedule Surface

The default Dashboard keeps one primary hierarchy: compact toolbar → compact exception shortcuts → day timeline or full weekly timetable. Project health, full unplanned decisions, capacity, change history, integration status, recurrence, daily close, and advanced fields remain available through Sheets, menus, or settings. This prevents repeated summaries, low-frequency administration, and AI marketing copy from displacing the schedule itself.

```tsx
// Wrong: ordinary capture is presented as AI-owned scheduling.
<PermanentAssistantCard title="AI 调度助手" />

// Correct: intent parsing is explicit, while placement remains rule-owned.
<Button aria-pressed={optimize}>AI 优化日程</Button>
<DayView items={scheduledItems} />
<UnplannedTray tasks={unplannedTasks} />
```

## Design Decision: Controlled Interaction Surfaces

The application uses Radix primitives for dismiss/focus/keyboard behavior and keeps product state in two explicit unions:

```ts
type TopLayer = "search" | "notifications" | "profile" | null;
type ActiveSurface = "settings" | "add-task" | "task-detail" | "mobile-nav" | "unplanned" | "activity" | null;
```

Do not replace these with peer `showX` booleans or document-level click listeners. A controlled union makes impossible combinations unrepresentable, while the primitive owns outside click, Escape, focus trapping, Portal placement, and trigger restoration.

## Design Decision: Readable Weekly Blocks and Hydration-Safe Time

The weekly timetable optimizes for answering “when do I do what?”. Persistent block copy therefore stays at two lines while the button itself carries the complete accessible description:

```tsx
<button aria-label={`${title}，${kind}，${status}，${project}，${duration}，${start}–${end}`}>
  <strong>{title}</strong>
  <span>{start}–{end}</span>
</button>
```

Current time is external browser state, not deterministic server data. Subscribe once at the Dashboard boundary and pass the numeric minute projection downward:

```tsx
const currentMinutes = useSyncExternalStore(subscribeToClock, getClockSnapshot, () => -1);
<WeekView currentMinutes={currentMinutes} />
```

The `-1` server snapshot intentionally renders no marker during SSR. Hydration then reads the client clock and subsequent minute ticks update the same projection without mismatched HTML.

## Scenario: Dashboard client boundaries and on-demand surfaces

### 1. Scope / Trigger

- Apply this pattern when adding a low-frequency Dashboard surface, advanced editor, integration panel, or interaction code that is not required to render the initial calendar.
- The goal is to keep schedule execution visible immediately while preventing settings and advanced workflows from growing the main Dashboard chunk without a budget check.

### 2. Signatures

```tsx
const ScheduleAddTaskSurface = dynamic(
  () => import("@/features/schedule/components/schedule-add-task-surface")
    .then((module) => module.ScheduleAddTaskSurface),
  { ssr: false },
);

pnpm build
pnpm check:bundle
```

### 3. Contracts

- `schedule-dashboard.tsx` owns server-state coordination, mutation commands, the active-surface union, and the page shell. It does not own the detailed JSX for timeline geometry, add-task forms, or task-detail/recurrence editing.
- Day/week drag geometry lives in `features/schedule/components/schedule-timeline.tsx`; shared date/time display helpers live in `features/schedule/view-utils.ts`.
- Low-frequency surfaces use explicit `next/dynamic` imports with `ssr: false` and render only when their `ActiveSurface` value is selected. A closed surface must not mount its Radix portal or execute its child component.
- Surface components receive typed values and callbacks. They do not fetch, mutate persisted schedule state directly, or recreate scheduling decisions.
- `scripts/check-client-bundle.mts` reads the production page client manifest after `pnpm build`. The Dashboard entry must remain at or below 140000 gzip bytes and its largest raw entry chunk at or below 430000 bytes until an explicitly measured budget change is approved.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| `.next` production manifest is absent | `pnpm check:bundle` fails with a run-build-first error |
| Entry gzip or largest-chunk budget is exceeded | Bundle check fails; split or remove initial code before changing the limit |
| Dynamic add/settings/detail module is still loading | Preserve the triggering page and focus intent; never mount a second surface |
| Dynamic surface closes | Clear the matching `ActiveSurface` state and restore focus through the existing Sheet contract |
| Surface callback mutates schedule data | Route through the parent command handler and consume the validated API snapshot |

### 5. Good / Base / Bad Cases

- Good: the initial calendar loads without task-detail code; clicking a task downloads the detail chunk and preserves recurrence/reminder behavior.
- Base: always-visible week/day timeline components remain statically imported because every Dashboard visit needs one of them.
- Bad: importing a new settings SDK or advanced form directly into `schedule-dashboard.tsx`, rendering six closed Sheet trees on every visit, or raising the bundle budget without a production network measurement.

### 6. Tests Required

- Run `pnpm build && pnpm check:bundle` and record raw/gzip entry totals.
- Playwright must open settings, activity, add-task, and task-detail surfaces after a cold page load; assert focus/close behavior and durable mutation round trips remain intact.
- Re-run the real-pointer timetable drag test because timeline extraction must not change coordinate or payload behavior.
- Production-shaped mobile smoke must retain day mode, zero horizontal overflow, stable hydration, and no layout shift caused by dynamic surfaces.

### 7. Wrong vs Correct

#### Wrong

```tsx
import { AdvancedTaskEditor } from "./advanced-task-editor";
<Sheet open={false}><AdvancedTaskEditor /></Sheet>
```

#### Correct

```tsx
const AdvancedTaskEditor = dynamic(() => import("./advanced-task-editor").then((module) => module.AdvancedTaskEditor), { ssr: false });
{activeSurface === "task-detail" && <AdvancedTaskEditor {...typedProps} />}
```
