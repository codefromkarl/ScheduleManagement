# 个人任务进度管理实现计划（草案）

## Status

Implementation is in progress. The Web flow now covers the core schedule, settings, project, recurrence, reminder, candidate scoring, preference suggestions, website-AI paths, and authenticated private HTTPS through Cloudflare Tunnel. The current rollout selects QQ as the only reminder/input channel; QQ credentials and real delivery plus cloud AI remain external account gates, while PWA phone acceptance and Tailscale deployment are deferred.

> Current implementation checkpoint: Next.js Web/PWA, shared UI primitives, deterministic scheduling, SQLite/LibSQL migrations and repository, configurable single-user authentication, task/project/preference/recurrence APIs, ChangeSet confirmation/undo, structured AI Provider, PWA subscription API, and QQ/PWA worker entrypoints are implemented. The current authenticated deployment uses `AUTH_DISABLED=false`; `REMINDER_CHANNELS=qq` selects QQ-only delivery. Real QQ credentials and the owner OpenID are configured; cloud AI plus delayed/human QQ delivery acceptance remain.

> Deployment checkpoint: Docker Compose runs `goalset-app` plus optional QQ/PWA workers against the shared bind-mounted `data/goalset.db`; the app starts by applying SQLite migrations and serving the production build on port 3000. Development fallback remains available only when `DATABASE_URL` is absent.

## Ordered Work

### 0. Feasibility and project setup

- [ ] Confirm the QQ official Bot application path, C2C private-message intent, sandbox account, credentials, and supported transport.
- [x] Use an authenticated Cloudflare Tunnel at `goalset.codefromkarl.xyz`; keep the Firefly root domain unchanged and retain app-level owner authentication until Cloudflare Access is separately configured.
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
- [x] Add and run supervised six-digit owner pairing, refuse implicit rebinding, disable payload-level QQ SDK debug logs, and redact/bound provider errors before persistence or logging.
- [x] Reserve QQ receipt/help phrases before task parsing and add a bounded delayed QQ test through the normal reminder outbox; near-match task text remains unaffected.
- [x] Reuse the website command service and return concise schedule results, questions, and confirmations.
- [ ] Replace QQ direct `insertTask`/reschedule mutations with a pure proposal service and durable expiring `pending_confirmation` payload; confirm against the latest schedule before atomic apply.
- [ ] For QQ `no_slot`, expose an explicit `save_unplanned` action that creates only after confirmation; retain change-constraints/optimize/cancel alternatives and create nothing on expiry/cancel.
- [ ] Add proposal expiry, supersession, stale-snapshot regeneration, interaction/message idempotency, and tests proving zero task/block/ChangeSet/reminder rows before confirmation.
- [ ] Add structured proposal presenters and an inline-keyboard interaction handler with owner authorization, durable interaction claims, fast ACK, opaque proposal/action data, and text-command fallback using the same proposal state machine.
- [ ] Add optional cropped schedule-image rendering only for conflict/multi-move/cross-date proposals; preserve a complete text diff and prove image generation/upload failure falls back without mutation.
- [ ] Classify QQ mutations before execution: schedule-affecting/create/save-unplanned operations always propose; exact status/notes updates use the audited update service and return ChangeSet-backed undo, while ambiguity/date/time changes return to clarification/proposal.
- [ ] Add owner/expiry/idempotency/conflict checks for QQ undo buttons and text fallback; prove unsafe undo never overwrites later task or schedule changes.
- [ ] Enforce one active schedule-proposal slot per owner with transactional supersession and explicit user copy; old button/text actions return stable no-op states and immediate status/note updates leave the slot unchanged.
- [ ] Add versioned 15-minute expiry: change-time/duration resets via a new preview, reads do not extend, expired confirmation only regenerates, and terminal cancelled/applied proposals cannot be revived.
- [ ] Add deterministic `change_time` candidates: at most three same-day-first/no-move safe slots within constraints, plus other/back/cancel; every selection creates a new un-applied preview and optimize-only moves never leak into normal candidates.
- [ ] Add `change_duration` quick values plus natural-language other-duration parsing, 15-minute normalization, current selection state, new-version recomputation, and zero-write `no_slot` handling.
- [ ] Add 15-minute ChangeSet-backed QQ undo actions for applied schedule/status/note mutations with owner, expiry, interaction dedupe, terminal-state idempotency, and later-change conflict coverage.
- [ ] Implement deterministic image-trigger classification and bounded relevant-window rendering for moves/cross-date/multi-task/occupied-no-slot/multi-change optimize only; unit-test simple exclusions and transport-failure fallback to the unchanged pending proposal.
- [ ] Add sandbox integration tests and a real account smoke test without exposing credentials.
- [x] Run an isolated AstrBot-gateway POC contract for exact UMO outbound envelopes, least-privilege bearer requests, owner rejection, injectable durable duplicate claims, and a fake-gateway runtime smoke without granting AstrBot a second scheduling authority. Real C2C credentials and passive reply remain external acceptance.
- [ ] Finish QQ-only acceptance: C2C pairing, official API authentication, human-confirmed immediate proactive sends, and one outbox effect across worker restart are proven; only the scheduled reminder beyond the passive-reply window remains.

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

### 4.4 True weekly timetable and Dashboard reduction

- [x] Remove the next-task card and completed/scheduled summary strip without removing the compact unplanned/risk entrypoints.
- [x] Replace the seven-day summary selector plus selected-day timeline with one Monday-through-Sunday timetable on a shared dynamic time range.
- [x] Preserve task-detail selection and validated 15-minute desktop drag/drop, including cross-day rescheduling; keep mobile day mode and its date navigation unchanged.
- [x] Extend isolated Playwright coverage to prove multiple dates render concurrently in the weekly timetable and that the removed summary blocks no longer appear.

### 4.5 Weekly schedule readability and interaction feedback

- [x] Render weekly blocks as readable title plus start–end time; retain kind through color/border rather than persistent micro-copy.
- [x] Expose full title, kind, status, project, and duration through an accessible hover/focus disclosure owned by the domain task block without adding a conflicting dependency.
- [x] Preserve task-detail click, keyboard activation, drag payloads, cross-day rescheduling, dynamic range, and mobile day-view rendering.
- [x] Strengthen the current-time cue, half-hour grid, and exact 15-minute drag-target feedback without changing scheduling semantics.
- [x] Extend isolated Playwright assertions for the reduced block copy, disclosure content/focus behavior, hydration-stable current time, half-hour guides, and snapped drag target.

### 4.6 Drag reachability and adapter parity

- [x] Move the top-ranked desktop unplanned drag sources into the compact Dashboard entry and remove misleading draggable/grip behavior from the modal Sheet.
- [x] Carry duration in both scheduled and unplanned drag payloads; render a start–end ghost while keeping final legality server-owned.
- [x] Replace the conflict card overlay with a narrow marker that leaves the blocking task visible and preserves accessible reason text.
- [x] Make the in-memory adapter support the same cross-date schedule/reschedule lifecycle as SQLite, including origin removal, target insertion, task-date update, and undo.
- [x] Add real-pointer browser coverage for unplanned placement plus focused adapter tests for cross-date schedule/reschedule/undo; rerun all quality gates.

### 6. Reminders and background work

- [x] Implement reminder events for task start, affected schedule, and daily risk summary; risk-summary content is intentionally a link back to the Dashboard.
- [x] Add PWA reliable delivery and conditional QQ delivery entrypoints with deduplication records, atomic claims, stale-send recovery, and failure states; real PWA permission/delivery and QQ channel smoke remain open.
- [x] Add a user-triggered PWA test reminder, per-device push isolation, expired-subscription pruning, provider-acceptance state, service-worker receipt callback, and received-at history. Automated Chrome truthfully reports when the host Push Service refuses registration.
- [x] Add explicit channel selection, a QQ test outbox endpoint, QQ API-accepted versus client-received copy, and QQ-only settings behavior that ignores leftover PWA credentials.
- [ ] Deferred by user: complete the human PWA gate only if PWA is explicitly re-enabled later; do not deploy Tailscale for the current QQ-only rollout.
- [x] Add recurrence materialization and conservative single-occurrence override handling, plus worker heartbeat/last-success diagnostics exposed through `/api/status` and settings.

### 7. Progress, backup, and operations

- [x] Implement estimated-minute weighted project progress, remaining minutes, overdue/blocked/unplanned/deadline-risk counts, and a project health label in the project API and sidebar; missing-estimate detail is open.
- [ ] Implement richer deadline-feasibility scoring beyond the current overdue/blocked/unplanned signals.
- [x] Add private authentication, secret separation, a consistent SQLite `VACUUM INTO` backup path, an explicitly confirmed temporary-file restore rehearsal, and ChangeSet audit export.
- [x] Deploy locally with Docker Compose and run browser/API/mobile/worker smoke checks; LAN IP login/API access is verified, while personal-server HTTPS and QQ sandbox checks remain open.
- [x] Deploy authenticated HTTPS through a dedicated healthy Cloudflare Tunnel, with a pre-deploy SQLite backup, persistent Compose runtime, anonymous redirect/401 checks, authenticated API checks, and real 1440px/390px browser smokes.

### 8. Password owner login

- [x] Keep the existing single-owner password JWT flow and cancel the proposed Google OAuth migration per the latest user instruction.
- [x] Keep `AUTH_DISABLED=false`, store the user-selected password only in ignored `.env.local`, recreate the production app, and verify wrong-password `401`, correct-login `200`, secure cookie, anonymous API `401`, and authenticated API `200`.

### 9. One-off/recurring creation and AI classification

- [ ] Extract a shared recurrence draft schema and reuse it in recurrence CRUD, schedule creation, AI structured output, and UI response parsing.
- [ ] Extend the schedule store and create API with an optional recurrence draft; persist task/block or unplanned state, recurrence rule, audit, and reminders atomically while preserving all one-off callers.
- [ ] Add a visible “一次性 / 周期” choice to the task creation sheet, default to one-off, and expose daily/workday/weekly/selected-weekday plus optional end date only in recurring mode.
- [ ] Extend deterministic natural-language parsing for explicit Chinese recurrence phrases and extend cloud structured output for recurring/one-off/uncertain decisions.
- [ ] Return recurrence plans as immutable previews with no database write; add a concrete confirmation UI and post confirmation through the same validated atomic schedule-create contract.
- [ ] Preserve existing single-occurrence skip/move/override and recurrence materialization behavior; reject unsupported monthly/custom rules and invalid ranges/weekday combinations.
- [ ] Add domain, store, route, provider, and isolated Playwright coverage for one-off creation, each supported recurrence class, AI preview non-mutation, confirmation, ambiguity clarification, mobile controls, and future instance materialization.

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
- Passed (2026-08-21 weekly timetable reduction): 42/42 Vitest, lint, TypeScript, production build (26 static pages/routes), Trellis validation, and 6/6 isolated Playwright. Desktop Chrome rendered Monday-through-Sunday tasks concurrently on one shared dynamic time range, persisted a validated cross-day drag, and omitted the next-task/completed-scheduled summary blocks; 390px mobile day mode remained overflow-free, and port 3100 was released after the run.
- Passed (2026-08-21 weekly readability): 47/47 Vitest, lint, TypeScript, production build (28 static pages/routes), Trellis validation, and 6/6 isolated Playwright. A fixed 12:45 client clock rendered one hydration-stable current-time label; weekly blocks exposed title plus start–end time and complete focus metadata; half-hour guides and a 13:15 snapped drag preview were visible; existing cross-day persistence, conflict handling, and 390px mobile no-overflow remained green. A 1440px Chrome visual smoke confirmed all seven columns without horizontal overflow, readable task cards, focus disclosure, and exact drag target.
- Passed (2026-08-21 drag reachability): 54/54 Vitest, lint, TypeScript, production build (29 static pages/routes), Trellis validation, and 7/7 isolated Playwright with QQ credentials explicitly unset to satisfy the current test contract. A real pointer `dragTo` moved a compact unplanned chip into another visible week column and persisted its target task date/block; Sheet rows had no draggable/grip affordance; duration-aware `13:15–13:45` ghost feedback, narrow non-obscuring conflict marker, scheduled same/cross-date persistence, fixed protection, 390px no-overflow, and in-memory cross-date placement/reschedule undo all passed. The first unqualified Playwright run exposed two unrelated QQ-environment assertions (`202` vs expected `409`, configured copy vs unconfigured copy); no QQ code/assertions were changed in this slice.
- Passed (2026-08-21 private HTTPS): backed up SQLite, restored `AUTH_DISABLED=false`, rotated the development password/secret, built the current production image, kept app/PWA worker healthy, and registered four QUIC Tunnel connections. `https://goalset.codefromkarl.xyz` redirects anonymous users to login; the old password returns `401`; owner login plus root/status/manifest return `200` with a secure HTTP-only session cookie. Real 1440px and 390px Chromium sessions rendered without console errors or horizontal overflow and registered the service worker.
- Passed (2026-08-21 reliable PWA and AstrBot gateway POC): 47/47 Vitest, lint, TypeScript, Drizzle check, migration 0003, production build (28 generated pages/routes), and 6/6 isolated Playwright. An isolated SQLite one-shot worker preserved an exact push transport failure without mutating tasks; headless and Xvfb Chrome both exposed `Registration failed - permission denied` instead of creating a false subscription. The AstrBot smoke script passed against a local fake `/api/v1/im/bots` plus `/api/v1/im/message` gateway, including exact UMO payload and explicit send opt-in. Real device Push Service and real AstrBot/QQ credentials remain external gates.
- Deployed locally (2026-08-21): created `backups/pre-pwa-receipt-20260821T133850.db`, verified it and restricted it to `0600`; built fresh App/PWA images; applied migration 0003; and verified healthy App/worker, HTTP/API availability, `quick_check = ok`, zero foreign-key violations, and the live `received_at` column. PWA had zero subscribed devices. Tailscale Serve was never configured and is no longer required for the QQ-only rollout.
- Passed and deployed (2026-08-21 QQ-only): added explicit `REMINDER_CHANNELS=qq`, QQ test outbox/API/UI, and channel-aware delivery wording; 50/50 Vitest, lint, TypeScript, Drizzle check, production build (29 generated pages/routes), Compose config, and 6/6 isolated Playwright passed. The live App is healthy with authentication enabled, reports `reminderChannels: ["qq"]`, rejects the test truthfully with `QQ_NOT_CONFIGURED`, keeps the PWA worker stopped, and has `quick_check = ok` with zero foreign-key violations. Tailscale Serve status remains empty.
- Passed and deployed (2026-08-21 password restore): canceled the planned Google migration, kept `AUTH_DISABLED=false`, stored the user-selected password only in ignored `.env.local`, removed the stale default-password copy, and rebuilt the 29-route production app. Public wrong-password/anonymous API requests return `401`; correct login and authenticated API return `200` with a secure HTTP-only cookie. Real 1440px and 390px Chromium logins render the expected schedule without console errors or horizontal overflow; App, QQ worker, and Tunnel remain running.
- Passed (2026-08-21 commit candidate): 59/59 Vitest, ESLint, TypeScript, Drizzle schema check, 29-route production build, Compose parse, SQLite quick/foreign-key checks, Trellis validation, and a clean 7/7 isolated Playwright rerun with QQ credentials explicitly empty. The first Playwright attempt had one transient 30-second timeout; its cleanup omission caused a cascading 14:00 conflict, while both exact scenarios and the complete rerun passed without code changes.
- Passed (2026-08-21 real QQ bring-up): a one-time six-digit C2C command discovered and acknowledged the intended owner OpenID; the official token endpoint and WebSocket Gateway connected; a conditional daily-risk summary and two QQ test reminders were accepted by the C2C send API. Recreating and restarting the worker left the sent-test count unchanged (`2 -> 2`), and the rebuilt worker logs lifecycle/HTTP status without message bodies. 55/55 Vitest, lint, TypeScript, Drizzle, Compose, and production build remain green.
- Human-confirmed (2026-08-21): the QQ client displayed the identity acknowledgement, risk summary, and exactly two intentional test reminders. Two receipt messages had been truthfully persisted with clarification replies and caused zero QQ tasks; the follow-up fix now reserves receipt/help commands before scheduling. A normal-outbox delayed QQ test is pending for 14:38:21 Asia/Shanghai; 59/59 Vitest plus lint, TypeScript, Drizzle, Compose, and the rebuilt production containers are green.
- Passed (2026-08-21 dashboard performance and QQ proposal candidate): 70/70 Vitest, ESLint, TypeScript, Drizzle check, 30-route production build, Dashboard bundle budget, Compose parse, Trellis validation, and 7/7 isolated Playwright passed. Production-shaped browser measurement reduced initial planning reads from 15 API requests to 6, kept mobile CLS at zero, and moved low-frequency add/detail/settings code behind dynamic client boundaries. Migrations 0004/0005 were validated in isolated databases but were not applied to the live personal database. The QQ proposal-image smoke rendered a 28,580-byte PNG locally with external sending disabled; real inline-keyboard/image transport remains an external sandbox gate.
- Expected but not passed: real cloud AI (the available `OPENAI_API_KEY` returned HTTP 401), user confirmation that the QQ client displayed the immediate messages, and a scheduled reminder beyond the passive-reply window. Real mobile push delivery remains deferred.
- Follow-up gaps: cloud AI/QQ credentials, optional Cloudflare Access/passwordless identity, optional future PWA re-enable, dedicated project health page, silent AI preference learning beyond the explicit suggestion, daily risk detail beyond the Dashboard link, and randomized property/idempotency tests remain open.

## Acceptance Scenarios

1. Add a fixed appointment and a flexible two-hour task; the weekly Dashboard shows both and the scheduler never moves the appointment automatically.
2. Send a temporary task with a free slot; AI inserts it, returns the placement, and creates an auditable change set.
3. Explicitly invoke AI optimization for a temporary task that conflicts with elastic work; the system previews a safe shift and can apply/undo it only after confirmation.
4. Add an ordinary task with no empty slot; it remains unplanned without moving anything, while a fixed appointment or hard deadline remains immutable even during optimization.
5. Send a task without a duration; high-confidence defaults are shown for confirmation, while low-confidence input produces one concise clarification question.
6. Repeat a weekly task, edit one occurrence, and verify the parent recurrence rule remains unchanged.
7. View the same data in desktop week mode and mobile day mode; status and AI changes remain synchronized.
8. Receive a QQ test reminder and verify short, beyond-reply-window, and worker-restart delivery; a failed reminder does not change task state. PWA remains disabled for this rollout.
9. Add or complete a project task and verify weighted progress and health explanation update without a hand-entered percentage.

## Risky Boundaries and Rollback Points

- QQ capability verification: keep the adapter isolated; if the official C2C path is unavailable, ship Web chat and the core scheduler without replacing it with personal-account automation.
- Scheduler mutation: apply only through change sets and database transactions; disable auto-apply behind a feature flag if unexpected moves appear.
- AI provider: retain a deterministic manual path and provider interface; disable AI commands without disabling the Dashboard.
- Recurrence: materialize and override instances conservatively; never rewrite the parent rule when editing one occurrence.
- Notifications: use an outbox/deduplication record and bounded retries; never couple delivery success to domain state.
- Deployment: take a database backup before migrations and keep a tested restore path; do not expose credentials or the private app without authentication.
