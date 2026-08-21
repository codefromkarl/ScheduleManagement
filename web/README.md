# goalset

Personal schedule orchestration: a responsive Web/PWA dashboard, deterministic 15-minute scheduling, optionally protected task APIs, and optional AI/QQ/PWA channels.

## Local startup

```bash
pnpm install
pnpm db:migrate
pnpm db:seed # optional: create one demo day
pnpm dev --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. `AUTH_DISABLED=true` is permitted only on a trusted LAN and gives every reachable client full owner read/write access. The current HTTPS deployment uses `AUTH_DISABLED=false`; use strong `OWNER_PASSWORD` and `AUTH_SECRET` values before any public exposure.

The project-owned `web/.env.local` is ignored by Git. Copy `.env.example` when creating another environment. Goalset stores its SQLite database at `data/goalset.db`; the directory is shared with the app and optional worker containers, but it is never exposed as a network service. Normal API reads never create demo tasks; use `pnpm db:seed` explicitly for a sample day.

Compose defaults to the current Goalset host owner (`1001:1001`) so the Web process and workers can create SQLite WAL files in the bind mount. On a machine with a different owner, set `GOALSET_UID=$(id -u)` and `GOALSET_GID=$(id -g)` in the shell before running Compose.

To run the production-shaped app container locally, after creating `.env.local`:

```bash
docker compose up -d --build goalset-app
```

For a phone on the same trusted private LAN, find the computer's LAN address with `hostname -I` and open `http://<LAN-IP>:3000` on the phone. Compose publishes the Web service on all host interfaces. With `AUTH_DISABLED=true`, no login is required and every reachable client has full access. Do not expose this port to the public Internet; restore authentication and put the service behind HTTPS before WAN access. Service-worker installation and real Push notifications require a secure context (HTTPS, or localhost), so use an HTTPS reverse proxy or private HTTPS network such as Tailscale for PWA notifications.

Reminder delivery is selected with `REMINDER_CHANNELS` (`qq`, `pwa`, or `qq,pwa`). The current personal rollout uses `REMINDER_CHANNELS=qq`; credentials alone never activate an unselected channel. QQ and PWA workers are opt-in profiles:

```bash
docker compose --profile qq up -d goalset-qq-worker
docker compose --profile pwa up -d goalset-pwa-worker
```

## Private HTTPS deployment

The personal-host deployment publishes only `goalset.codefromkarl.xyz` through a dedicated Cloudflare Tunnel; `codefromkarl.xyz` remains the Firefly site. Tunnel credentials and `config.yml` live in ignored `web/cloudflared/` and must not be committed.

Before starting the Tunnel, set `AUTH_DISABLED=false`, verify strong owner secrets, and create an online SQLite backup:

```bash
pnpm db:backup
docker compose --profile pwa up -d --build goalset-app goalset-pwa-worker
docker compose up -d goalset-tunnel
```

The Tunnel container runs as `GOALSET_UID:GOALSET_GID` so it can read mode-`600` credentials without weakening permissions. A valid deployment has a healthy app and Tunnel, redirects anonymous HTTPS requests to `/login`, returns `401` for anonymous protected APIs, and returns `200` after owner login.

## Optional integrations

### AI

Set `AI_PROVIDER=openai`, `AI_API_KEY` (or `OPENAI_API_KEY`), and `AI_MODEL`. The server sends a bounded schedule context to the configured provider and validates the structured task plan before invoking the deterministic scheduler. `AI_PROVIDER=mock` is available for local integration tests without an external API call.

### QQ Bot

Set `QQBOT_APP_ID`, `QQBOT_APP_SECRET`, and `QQBOT_OWNER_USER_ID`, then run:

```bash
pnpm worker
```

The worker exits clearly when QQ credentials are absent. It accepts only C2C messages from the configured owner identity and reuses the website AI/scheduling service.

To identify the owner OpenID without accepting an arbitrary first sender, configure App ID/secret while leaving `QQBOT_OWNER_USER_ID` empty, then run `pnpm qq:pair`. Send the exact six-digit `绑定 Goalset ...` command printed by the process from the intended QQ account. Pairing expires after ten minutes and refuses to replace an existing owner unless rebind is explicitly enabled. Copy the resulting OpenID into `QQBOT_OWNER_USER_ID`; AppSecret and message bodies must never be logged.

With `REMINDER_CHANNELS=qq`, Settings exposes a QQ test action. It enqueues one outbox record and waits through the 30-second worker interval. A `sent` result proves only that the QQ API accepted the request; confirm the message in the QQ client before treating delivery as passed. The current rollout keeps the PWA worker stopped and does not require Tailscale.

`POST /api/qq/test` also accepts `{ "delayMinutes": 15 }` for a bounded proactive-delivery acceptance run. QQ receipt phrases such as `已收到` or `都收到了，测试提醒2条` and `帮助` are reserved channel controls handled before task parsing; they never create or modify a schedule. A normal sentence that merely contains `已收到` remains eligible for task parsing.

QQ schedule creation/rescheduling is proposal-first: preview and pending-proposal persistence create no task/block/applied ChangeSet/reminder rows. Text `确认 P-XXXXXXXX`, `取消 P-XXXXXXXX`, or `保存到待安排 P-XXXXXXXX` revalidates and atomically applies one action. Proposal TTL is 15 minutes and one owner has one active slot. `QQBOT_INLINE_KEYBOARD_ENABLED` defaults false and must remain false until a real client renders buttons and an interaction callback is observed; HTTP acceptance alone is not capability proof.

Complex proposal PNGs use deterministic English time/relationship labels while the companion text retains full Chinese task detail. Run `pnpm qq:image-smoke` for a dry render; external send requires `QQ_PROPOSAL_IMAGE_SMOKE_SEND=true`. Image failure always falls back to text without changing proposal state.

When inline keyboard is unavailable, text proposal edits remain first-class: `改时间 P-XXXXXXXX` lists up to three rules-safe candidates, `改时间 P-XXXXXXXX 2026-08-22 14:30` creates a replacement exact-time preview, and `改时长 P-XXXXXXXX 60` creates a replacement insert-task duration preview. These commands reset the 15-minute proposal TTL but never apply without a later confirmation.

An isolated AstrBot gateway probe is also available without installing AstrBot into Goalset. Set `ASTRBOT_BASE_URL`, a least-privilege `ASTRBOT_API_KEY`, and `ASTRBOT_OWNER_UMO`, then run `pnpm astrbot:smoke`. The command probes `/api/v1/im/bots` only. It sends one external test message only when `ASTRBOT_SMOKE_SEND=true` is explicitly present. AstrBot remains a transport sidecar and must not run a second Goalset scheduler or future-task system.

### PWA reminders

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`, then run:

```bash
pnpm pwa-worker
```

The browser subscription API and service worker are optional; no fake notification is created when VAPID is not configured. Phone/LAN use requires HTTPS, while `localhost` is accepted as a secure context for local testing. The settings panel reports configured credentials and subscribed-device count, and can enqueue a test reminder. Provider acceptance is shown separately from the service-worker `receivedAt` receipt; only the latter proves that a device received the push event.

For an isolated one-shot dispatcher smoke, set `PWA_WORKER_ONCE=true` when running `pnpm pwa-worker`. Expired `404`/`410` subscriptions are pruned independently, so one stale device does not fail healthy subscriptions.

The Dashboard settings panel can edit the seven weekly availability rules, add one-off unavailable windows, set the task buffer, choose or clear an explicit AI default duration, and enable PWA reminders. Selecting a task exposes recurrence creation and single-occurrence move/skip controls; recurring instances are materialized into the same SQLite schedule when their date is viewed.

The notification menu reads the reminder outbox and exposes failed reminders for retry. QQ messages are claimed by external message ID before parsing, so duplicate official-Bot deliveries do not create duplicate tasks. Website and QQ commands share task creation, status updates, relative dates, and exact-time rescheduling; a reschedule that would move elastic tasks waits for confirmation.

`GET /api/status` also exposes selected reminder channels and the last worker run/success/error heartbeat; the settings panel shows only selected worker/channel state and whether its credentials are configured.

The adjustment history can be exported from the Dashboard as CSV through `/api/change-sets/export?format=csv`. After at least three non-seed tasks use the same duration, Settings may show a visible default-duration suggestion; it is never applied automatically.

## Checks

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm db:check
pnpm db:backup
# destructive and explicit; stop app/workers first:
GOALSET_RESTORE_CONFIRM=1 pnpm db:restore backups/file.db
```

SQLite runs in WAL mode with foreign keys and a five-second busy timeout. `pnpm db:backup` creates a consistent online snapshot using `VACUUM INTO`. Before restoring, stop `goalset-app`, `goalset-qq-worker`, and `goalset-pwa-worker`; the restore command refuses to run without the explicit confirmation variable.

The scheduling core has unit coverage for 15-minute alignment, availability, buffer, fixed conflicts, movable-task proposals, exact reschedules, deadline/project/fragmentation scoring, recurrence dates, DST calendar boundaries, and leap days.
