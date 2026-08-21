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
- The Dashboard is an execution surface, not a feature inventory: render the next scheduled task, one compact truthful summary, unplanned work that needs a decision, and the selected-day timeline before history or diagnostics.
- Week mode is a compact seven-day selector followed by the selected day timeline. It must not replace the actionable timeline with seven tall summary columns.
- Natural-language entry is an explicit disclosure. Ordinary input may parse intent but must describe placement as rule scheduling; only the separate `AI 优化日程` control may set optimization intent.
- New-task and task-detail surfaces use progressive disclosure: title plus duration are the fast path, while task kind, priority, recurrence, notes, occurrence overrides, and deletion remain under clearly labeled advanced controls.
- Summary values must come from the selected `ScheduleSnapshot`. Free minutes remove unavailable windows, scheduled blocks, and configured buffers; never use a fixed eight-hour constant or label free capacity as “待安排”.
- Tasks without a block remain visible in a `待安排` tray. Desktop may add drag-to-timeline, but mobile and keyboard users must also have explicit time-selection and AI-optimization buttons.

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
| A normal task has no safe slot | Keep it visible in the unplanned tray; do not hide it, report success as scheduled, or silently move another task. |
| The user opens natural-language entry | Focus the command input and expose whether the one-shot AI optimization authorization is off or on. |
| Mobile viewport is 390px wide | No horizontal page overflow; primary icon/calendar controls use approximately 44px hit areas and the next-task card appears before the timeline. |

## Good / Base / Bad Cases

- Good: a schedule card owns its timeline placement while using `Button` for “today”, “undo”, and confirmation actions.
- Good: the Dashboard says `2 项任务 · 1 项完成 · 15m 已安排`, then shows one unplanned item with `选择时间` and a separate `AI 优化` action.
- Base: a static section uses semantic HTML and local layout classes without introducing a new abstraction for a one-off visual.
- Bad: four permanent stat cards, a duplicate “focus list”, and a permanent AI assistant panel all repeat data already visible on the timeline.
- Bad: a `div` with click handlers reimplements a dialog, menu, or button, or a page directly casts an untyped AI payload.
- Bad: removing a task from the tray on `drop` before the server returns a validated snapshot, or keeping optimize mode active for later commands.

## Tests Required

- Run `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` for every UI slice.
- Add component or browser assertions for keyboard activation, accessible names, focus-visible states, and mobile/desktop layout where the component is interactive.
- For schedule components, assert fixed blocks are not moved by local interactions and that view changes preserve the underlying task identity.
- For the unplanned tray, assert the first three priority/deadline-ranked tasks render, exact-time placement consumes the returned snapshot, invalid placement remains visible, and mobile can complete the flow without drag.
- For the focused Dashboard, verify desktop week-selector plus day-timeline rendering, 390px no-overflow, quick-capture focus, collapsed advanced fields, unplanned manual placement, explicit optimization confirmation, and truthful free-time summaries.

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

The default Dashboard keeps one primary hierarchy: next task → truthful summary → unplanned decisions → selected-day timeline. Project health, change history, integration status, recurrence, and advanced fields remain available through filters, contextual side cards, or disclosure controls. This prevents low-frequency administration and AI marketing copy from displacing the daily execution loop.

```tsx
// Wrong: ordinary capture is presented as AI-owned scheduling.
<PermanentAssistantCard title="AI 调度助手" />

// Correct: intent parsing is explicit, while placement remains rule-owned.
<Button aria-pressed={optimize}>AI 优化日程</Button>
<DayView items={scheduledItems} />
<UnplannedTray tasks={unplannedTasks} />
```
