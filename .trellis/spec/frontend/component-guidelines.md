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
- The Dashboard is an execution surface, not a feature inventory: render the next scheduled task, one compact truthful summary, unplanned work that needs a decision, and the selected-day timeline before history or diagnostics.
- Desktop week mode is a planning workspace: keep the weekly schedule primary and use the wide-screen planning rail for actionable capacity, cross-date unplanned work, selected-date risk, and recent changes. Do not hide all planning evidence behind the activity Sheet.
- Mobile day mode is an execution workspace: default to today, keep the next task before the timeline, and expose previous day, next day, and an explicit native date picker. Selecting a date preserves day mode until the user explicitly switches views.
- Task details expose `自动`, `强制提醒`, and `不提醒` under advanced settings. The control persists only `reminderPolicy`; it must never rewrite priority, kind, or schedule constraints, and QQ-unconfigured copy must state that the saved policy activates after configuration.
- Week mode is a compact seven-day selector followed by the selected day timeline. It must not replace the actionable timeline with seven tall summary columns.
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
- The default Dashboard content budget is `toolbar → optional next task → compact summary/risk shortcut → optional unplanned shortcut → calendar`. Full unplanned lists, capacity, activity history, and daily-close actions belong in Sheets or menus, not stacked above the calendar.
- The Dashboard exposes one primary `添加任务` action. Manual entry and natural-language entry are modes of the same Sheet, not peer buttons or simultaneous panels.
- Hide absent/normal information: no next-task card when no next task exists, no summary when there are zero tasks, no positive “日程无风险” badge, no project selector when only one project exists, and no database/provider implementation text while services are healthy.
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
| Mobile viewport is 390px wide | No horizontal page overflow; primary icon/calendar controls use approximately 44px hit areas and the next-task card appears before the timeline. |
| Mobile user selects another date | Fetch the selected calendar key, preserve day mode, and keep previous/next/date-picker/today controls touch accessible. |
| Desktop defaults to week mode | Render the planning rail beside the schedule; each risk/unplanned summary must lead to the existing Sheet or selected date. |
| QQ is not configured | Allow task reminder policy edits and show truthful deferred-effect copy; do not disable unrelated task editing. |
| Avatar/notification/search opens | At most one topbar layer exists; outside click and Escape close it and focus returns to its trigger. |
| Settings/new task/quick capture/task detail opens | Render one modal Sheet, lock background scroll, focus its first control, and restore focus to the opening control on close. |
| Sidebar collapse changes | Persist the state, update the accessible label, keep project/settings controls keyboard reachable, and restore the same width after reload. |
| Destructive task/project action starts | Render `role="alertdialog"`; Escape/cancel returns focus to the destructive trigger and no mutation occurs. |
| A normal mutation succeeds | Show a time-bounded Toast; do not leave a permanent success banner in page flow. |
| Dense mobile state has next task and unplanned work | Calendar starts at or before 450px, the detailed unplanned list is absent from page flow, and there is exactly one add-task CTA. |
| No next task or no risks exist | Omit their cards/badges instead of rendering positive or empty-state containers above the calendar. |
| Rules/natural task creation is opened | One `添加任务` Sheet exposes `快速填写` and `一句话输入` tabs and keeps only one mode mounted as the active form. |
| Normal data/AI services are healthy | Do not render SQLite/provider/worker diagnostics on the calendar; show diagnostics only for loading/failure or inside settings/activity. |

## Good / Base / Bad Cases

- Good: a schedule card owns its timeline placement while using `Button` for “today”, “undo”, and confirmation actions.
- Good: the Dashboard says `2 项任务 · 1 项完成 · 15m 已安排`, then shows one unplanned item with `选择时间` and a separate `AI 优化` action.
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

## Tests Required

- Run `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` for every UI slice.
- Add component or browser assertions for keyboard activation, accessible names, focus-visible states, and mobile/desktop layout where the component is interactive.
- For schedule components, assert fixed blocks are not moved by local interactions and that view changes preserve the underlying task identity.
- For the unplanned tray, assert the first three priority/deadline-ranked tasks render, exact-time placement consumes the returned snapshot, invalid placement remains visible, and mobile can complete the flow without drag.
- Playwright must cover batch undo, scheduled drag/click reschedule, visible rejected-target feedback, daily-close confirmation/undo, and 390px overflow against the isolated E2E database.
- Planning projection coverage must include 07:00/22:00 timeline expansion, overdue/today/tomorrow grouping, capacity presence, and concrete optimization preview rows.
- For the focused Dashboard, verify desktop week-selector plus day-timeline rendering, 390px no-overflow, quick-capture focus, collapsed advanced fields, unplanned manual placement, explicit optimization confirmation, and truthful free-time summaries.
- Verify the desktop planning rail reuses the typed capacity/unplanned projections, mobile date selection preserves day mode, and task-detail reminder policy survives an API round trip without live QQ credentials.
- For interaction infrastructure, verify outside click, Escape, role/ARIA state, one-layer mutual exclusion, focus entry/return, sidebar 250→76 persistence across reload, mobile navigation capability parity, Sheet background scroll lock, AlertDialog cancellation, and Toast success feedback.
- For content density, seed scheduled, completed, blocked, unplanned, and changed work; assert one add CTA, conditional next/summary shortcuts, no default right rail or full unplanned tray, no healthy implementation status, and calendar top <= 450px at 390px.

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

The default Dashboard keeps one primary hierarchy: compact toolbar → optional next task → compact exception shortcuts → selected-day timeline. Project health, full unplanned decisions, capacity, change history, integration status, recurrence, daily close, and advanced fields remain available through Sheets, menus, or settings. This prevents low-frequency administration and AI marketing copy from displacing the daily execution loop.

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
