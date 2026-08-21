# 个人任务进度管理实现计划（草案）

## Status

Implementation is in progress. The local Web/PWA flow now covers the core schedule, settings, project, recurrence, reminder, candidate scoring, preference suggestions, and website-AI paths; QQ, cloud AI, private HTTPS, and real push delivery remain external account gates.

> Current implementation checkpoint: Next.js Web/PWA, shared UI primitives, deterministic scheduling, SQLite/LibSQL migrations and repository, configurable single-user auth bypass, task/project/preference/recurrence APIs, ChangeSet confirmation/undo, structured AI Provider, PWA subscription API, and QQ/PWA worker entrypoints are implemented. The current trusted-LAN deployment uses `AUTH_DISABLED=true` by explicit user request. Real AI/QQ/PWA credentials and external-channel smoke tests remain.

> Deployment checkpoint: Docker Compose runs `goalset-app` plus optional QQ/PWA workers against the shared bind-mounted `data/goalset.db`; the app starts by applying SQLite migrations and serving the production build on port 3000. Development fallback remains available only when `DATABASE_URL` is absent.

## Ordered Work

### 0. Feasibility and project setup

- [ ] Confirm the QQ official Bot application path, C2C private-message intent, sandbox account, credentials, and supported transport.
- [ ] Decide the private deployment shape: HTTPS endpoint, VPN, or reverse proxy based on the verified QQ transport.
- [x] Scaffold the TypeScript Web/PWA application, server runtime, worker entrypoint, database migrations, and environment validation.
- [x] Replace placeholder Trellis frontend/backend specs with repository-backed conventions after the scaffold exists.

### 1. Durable domain model

- [x] Implement tasks, schedule blocks, projects, availability rules, unavailable windows, recurrence rules, occurrence overrides, preferences, reminders, and push subscriptions.
- [x] Add calendar-key serialization and 15-minute time validation; full timezone/DST materialization remains a follow-up.
- [x] Add migration and explicit seed data for a single private user.
- [x] Add change-set/audit tables, CSV/JSON export, and reversible operation representation, including task status/notes/reschedule updates.

> The in-memory adapter remains only as a no-database development fallback. The active local deployment uses the SQLite adapter, authenticated API, migrations, and explicit `db:seed`.

### 2. Deterministic scheduling core

- [x] Normalize fixed, flexible, and floating task constraints.
- [x] Generate 15-minute candidate slots respecting availability, unavailable windows, fixed blocks, deadlines, and buffers; recurring instances are now materialized into the same scheduler context.
- [x] Score candidates by deadline safety, priority, preferred periods, project continuity, and fragmentation without weakening hard constraints.
- [x] Implement safe auto-insert, elastic-task movement, and confirmation-required conflict proposals.
- [x] Change normal task insertion to use only empty safe slots; persist no-slot tasks as unplanned without relocating existing blocks.
- [x] Gate elastic-task relocation and reordering behind an explicit AI-optimization intent while keeping deterministic validation and confirmation.
- [x] Require the dedicated Web “AI 优化日程” action or QQ “优化日程”/“AI 重排” prefix to set that intent; reject implicit reordering authorization from ordinary task text.
- [x] Split candidate ordering into predictable normal mode (exact, closest preferred, earliest safe) and explicit AI-optimization scoring; remove priority/project/fragmentation effects from normal placement.
- [x] Add unit tests for overlap, recurrence dates, unavailable-window buffers, deadline refusal, conflict proposals, exact rescheduling, project scoring, DST/leap-day date stability, deterministic placement, and structured AI behavior; randomized property/idempotency coverage remains open.

### 3. Desktop and mobile Web/PWA

- [x] Build the Dashboard with desktop-week and mobile-day defaults; the desktop week columns now read the seven real schedule snapshots.
- [x] Add day/week switching, task detail, project filtering, title/priority/status/notes editing, deletion, archive/project health display, recurrence editing, and recent AI changes.
- [x] Initialize the project-owned shadcn/ui component layer and use mature primitives for common controls.
- [x] Add the icon and minimal form foundations (`lucide-react`, shared `Button`/`Input`/`Badge`, and Zod API contracts); a larger form library is intentionally deferred while forms remain small.
- [x] Keep the schedule timeline, AI change preview, conflict view, and progress summaries as domain-specific UI.
- [x] Add responsive quick actions, PWA manifest/service-worker/subscription baseline, and visible reminder failure/retry state.
- [x] Add truthful loading, empty, conflict, unavailable-AI, and save-failure states; reminder history and a dedicated project/change page remain follow-up UI.
- [x] Replace misleading “AI 排程” copy in ordinary task creation with “规则排程”, and expose separate manual-time and explicit AI-optimization actions for unplanned tasks.
- [x] Add a compact Dashboard unplanned tray (three items plus expand), ranked for display by priority/deadline risk and hidden when empty.
- [x] Add an accessible exact-time placement flow and desktop 15-minute drag/drop onto the day timeline; route both through one validated domain/API mutation and preserve unplanned state on conflict.

### 4. Website AI chat

- [x] Define the validated command/intent schema and tool boundary for task creation, relative dates, task status updates, and exact-time same-day/cross-day rescheduling.
- [x] Implement cloud AI Provider adapter with server-side secrets and context trimming; the local environment currently uses the deterministic provider because the available cloud key is invalid.
- [x] Add deterministic missing-duration clarification behavior and an explicit user-controlled default-duration preference; confidence learning remains open.
- [x] Add structured proposal handling, confirmation, transaction application, audit, and undo.
- [x] Add an explicit, user-accepted duration suggestion from recent non-seed tasks, with visible edit/reset controls; silent automatic learning remains intentionally deferred.

### 4.1 Daily execution refinement

- [x] Remove duplicate optimization confirmation rendering and show an exact conflict marker/reason for failed click or drag targets.
- [x] Let scheduled flexible/floating blocks drag through the existing rules-only reschedule API; add an exact-time click flow for every scheduled task while preserving fixed-block drag protection.
- [x] Add transactional “按规则安排全部” with deterministic priority/deadline ordering, one ChangeSet, no existing moves, retained leftovers, and undo.
- [x] Add transactional daily close for incomplete non-fixed tasks: move to tomorrow unplanned or remain today unplanned; preserve fixed tasks and support undo.
- [x] Add Playwright with a dedicated SQLite database/server and desktop/mobile regressions for the approved scheduling boundaries.

### 5. QQ Bot adapter

- [ ] Implement and verify the official C2C transport behind a channel adapter; the official SDK worker entrypoint and owner allowlist are present, but no credentials are available for a real smoke test.
- [x] Bind one QQ identity, reject unauthorized senders, and persistently deduplicate external message IDs; real transport credentials and sandbox verification remain open.
- [x] Reuse the website command service and return concise schedule results, questions, and confirmations.
- [ ] Add sandbox integration tests and a real account smoke test without exposing credentials.

### 4.2 Cross-date planning and explainability

- [x] Add a read-only all-date unplanned projection and Dashboard Sheet grouped into overdue/today/tomorrow/this-week/later with date jump actions.
- [x] Add pure daily capacity projection plus a bounded range API and compact weekly capacity summary with explainable healthy/tight/impossible/unknown states.
- [x] Replace the fixed 08:00–19:00 coordinate assumptions with one snapshot-derived timeline range shared by labels, blocks, now line, drag/drop, and conflict markers.
- [x] Extract detailed schedule-change preview and unplanned/capacity/timeline presentation components from the Dashboard without changing mutation ownership.
- [x] Extend Vitest and isolated Playwright for cross-date groups, capacity, early/late timeline expansion, and concrete before/after move preview rows.

### 4.3 Responsive Dashboard hierarchy and important reminders

- [x] Recompose the desktop Dashboard as a week-planning workspace with the weekly schedule as the primary surface and actionable unplanned/capacity/risk context using the available wide-screen space.
- [x] Recompose the mobile Dashboard as a today-execution workspace with the selected date, next action, and day timeline first; add previous-day, next-day, and explicit-date touch navigation while preserving manual day/week switching.
- [x] Implement the confirmed deterministic importance policy before enqueueing QQ reminders: high-priority/fixed starts at T-15 minutes, changes affecting high-priority/fixed work, and daily summaries at 09:00 Asia/Shanghai only when overdue/blocked/impossible-capacity/unhandled-high-priority risk exists. Keep filtering separate from QQ transport enablement and preserve existing deduplication/retry behavior.
- [x] Add a migrated, typed task `reminderPolicy` field (`auto | always | never`) with `auto` as the backward-compatible default; thread it through SQLite/in-memory stores, task contracts, update API, recurrence materialization, exports, and audit snapshots.
- [x] Apply task overrides before reminder enqueue: `always` enables task-start/task-change eligibility, `never` suppresses task-specific start/change events, and neither value mutates priority, kind, or scheduling constraints. Preserve system-level aggregate capacity risk summaries.
- [x] Add settings copy and controls that expose whether QQ reminders are configured and which important reminder categories are enabled.
- [x] Add the three-state task reminder control under advanced task details with truthful QQ-unconfigured copy and no dependency on drag/drop.
- [x] Extend isolated Playwright coverage for desktop week default, desktop planning context, mobile today default, mobile date switching, and reminder-policy visibility without requiring live QQ credentials.
- [x] Add focused domain/store/API tests for auto eligibility, always/never overrides, 09:00 Asia/Shanghai conditional summaries, recurrence inheritance, deduplication, and retry preservation.

### 6. Reminders and background work

- [x] Implement reminder events for task start, affected schedule, and daily risk summary; risk-summary content is intentionally a link back to the Dashboard.
- [x] Add QQ primary delivery and optional PWA delivery entrypoints with deduplication records, atomic claims, stale-send recovery, and failure states; real channel delivery/retry smoke is open.
- [x] Add recurrence materialization and conservative single-occurrence override handling, plus worker heartbeat/last-success diagnostics exposed through `/api/status` and settings.

### 7. Progress, backup, and operations

- [x] Implement estimated-minute weighted project progress, remaining minutes, overdue/blocked/unplanned/deadline-risk counts, and a project health label in the project API and sidebar; missing-estimate detail is open.
- [ ] Implement richer deadline-feasibility scoring beyond the current overdue/blocked/unplanned signals.
- [x] Add private authentication, secret separation, a consistent SQLite `VACUUM INTO` backup path, an explicitly confirmed temporary-file restore rehearsal, and ChangeSet audit export.
- [x] Deploy locally with Docker Compose and run browser/API/mobile/worker smoke checks; LAN IP login/API access is verified, while personal-server HTTPS and QQ sandbox checks remain open.

## Validation Plan

Commands depend on the selected scaffold, but the intended gates are:

- formatter/linter;
- TypeScript type check;
- unit and property tests for the scheduling core;
- API/integration tests for command idempotency, change sets, reminders, and channel authorization;
- Playwright browser tests for desktop week view, mobile day view, AI confirmation/undo, and failure states;
- worker smoke test for reminder retry and recurrence materialization;
- QQ sandbox or test-account smoke test for inbound C2C message, reply, duplicate delivery, unauthorized sender, and reconnect behavior;
- deploy smoke test against the private HTTPS service and database backup/restore check.

## Local acceptance snapshot (2026-08-20)

- Passed: `pnpm test` (24/24), `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm db:check`, production `pnpm build`, `docker compose config --quiet`, and Trellis context validation.
- Passed: authenticated API loop for schedule read, task create/update/delete (including title/priority/notes), local AI insertion/status update/relative date/exact same-day and cross-day reschedule, ChangeSet undo, and conflict proposal/confirmation/undo.
- Passed: availability template and temporary blackout CRUD, same-project candidate scoring, project ID binding/progress/archive/deadline risk, recurrence create/materialize/skip/move/delete lifecycle, reminder query/retry/atomic-claim behavior, ChangeSet CSV export, positive/empty preference suggestion cases, and PWA subscription create/delete API. The PostgreSQL source received a final custom-format dump and 15-table JSON export; all row counts migrated to SQLite, `quick_check` passed, foreign-key violations were zero, a SQLite backup restored into a temporary file with all 26 tasks, and the live PWA worker wrote a successful heartbeat through the shared WAL database.
- Passed: Chrome desktop interaction smoke (login, real week labels, search, notifications, profile, settings, default-duration control, project health/archive affordance, recurrence detail, task edit fields, task form, day/week switch, AI clarification, and change-history export control) with no runtime errors; Chrome 390px smoke confirmed mobile day default and no horizontal overflow; LAN `10.89.1.204:3000` login/API session also passed.
- Passed: after the explicit no-password switch, unauthenticated loopback and LAN Dashboard/schedule requests return `200`, `/login` redirects to `/`, `/api/status` reports `authDisabled: true`, and a fresh Chrome page opens the Dashboard without a login card; the profile menu truthfully shows “当前无需密码”.
- Passed (2026-08-21): `pnpm test` (31/31), lint, TypeScript, SQLite schema check, production build, Compose config, and Trellis validation. Isolated API smokes proved normal no-slot persistence, no-move behavior, exact conflict refusal, click/drop placement, optimize preview immutability, explicit confirmation, and 15-minute buffer preservation.
- Passed (2026-08-21): Chrome desktop drag and click-to-time both moved a temporary unplanned task to exactly `14:30` and persisted the same SQLite block; Chrome 390px showed the tray before the calendar, day mode, touch-sized “选择时间 / AI 优化” controls, hidden drag grip, and no horizontal overflow. All temporary tasks and 14 test-only ChangeSets were removed after validation.
- Passed (2026-08-21 refinement): 33/33 Vitest checks and 3/3 isolated Playwright scenarios pass. Playwright covers rules batch plus whole-batch undo, scheduled drag/click reschedule, rejected-target marker, daily-close confirmation plus undo, and 390px mobile overflow. Production API smoke separately proved batch/daily-close transaction scope and undo, then removed all exact test task/reminder/ChangeSet IDs.
- Passed: final SQLite `quick_check = ok`, zero foreign-key violations, production build (24 routes), Compose config, healthy app/PWA worker, loopback/LAN HTTP `200`, and invalid batch input `400`.
- Passed (2026-08-21 responsive planning/reminders): 42/42 Vitest, lint, TypeScript, Drizzle check, two new migrations, isolated migrate/seed, production build (26 static pages/routes), Compose config, and 5/5 Playwright. Real Chrome rendering verified desktop week planning rail and 390px today execution/date navigation against an isolated SQLite database; task reminder policy round-tripped through the API and recurrence materialization inherited its template policy without live QQ credentials.
- Expected but not passed: real cloud AI (the available `OPENAI_API_KEY` returned HTTP 401), real QQ C2C private message/reply/reminder, and real mobile push permission/delivery. QQ worker exits clearly until its three credentials are provided.
- Follow-up gaps: cloud AI/QQ/real push credentials, private HTTPS authorization, dedicated project health page, silent AI preference learning beyond the explicit suggestion, daily risk detail beyond the Dashboard link, and randomized property/idempotency tests remain open.

## Acceptance Scenarios

1. Add a fixed appointment and a flexible two-hour task; the weekly Dashboard shows both and the scheduler never moves the appointment automatically.
2. Send a temporary task with a free slot; AI inserts it, returns the placement, and creates an auditable change set.
3. Explicitly invoke AI optimization for a temporary task that conflicts with elastic work; the system previews a safe shift and can apply/undo it only after confirmation.
4. Add an ordinary task with no empty slot; it remains unplanned without moving anything, while a fixed appointment or hard deadline remains immutable even during optimization.
5. Send a task without a duration; high-confidence defaults are shown for confirmation, while low-confidence input produces one concise clarification question.
6. Repeat a weekly task, edit one occurrence, and verify the parent recurrence rule remains unchanged.
7. View the same data in desktop week mode and mobile day mode; status and AI changes remain synchronized.
8. Receive a QQ reminder and verify PWA notification is optional; a failed reminder does not change task state.
9. Add or complete a project task and verify weighted progress and health explanation update without a hand-entered percentage.

## Risky Boundaries and Rollback Points

- QQ capability verification: keep the adapter isolated; if the official C2C path is unavailable, ship Web chat and the core scheduler without replacing it with personal-account automation.
- Scheduler mutation: apply only through change sets and database transactions; disable auto-apply behind a feature flag if unexpected moves appear.
- AI provider: retain a deterministic manual path and provider interface; disable AI commands without disabling the Dashboard.
- Recurrence: materialize and override instances conservatively; never rewrite the parent rule when editing one occurrence.
- Notifications: use an outbox/deduplication record and bounded retries; never couple delivery success to domain state.
- Deployment: take a database backup before migrations and keep a tested restore path; do not expose credentials or the private app without authentication.
