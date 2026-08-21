# goalset

Personal schedule orchestration: a responsive Web/PWA dashboard, deterministic 15-minute scheduling, optionally protected task APIs, and optional AI/QQ/PWA channels.

## Local startup

```bash
pnpm install
pnpm db:migrate
pnpm db:seed # optional: create one demo day
pnpm dev --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. The current local deployment has `AUTH_DISABLED=true`, so it opens the Dashboard directly without a password. Everyone who can reach the service has full owner read/write access. Set `AUTH_DISABLED=false` to restore the password login, and use strong `OWNER_PASSWORD` and `AUTH_SECRET` values before any public exposure.

The project-owned `web/.env.local` is ignored by Git. Copy `.env.example` when creating another environment. Goalset stores its SQLite database at `data/goalset.db`; the directory is shared with the app and optional worker containers, but it is never exposed as a network service. Normal API reads never create demo tasks; use `pnpm db:seed` explicitly for a sample day.

Compose defaults to the current Goalset host owner (`1001:1001`) so the Web process and workers can create SQLite WAL files in the bind mount. On a machine with a different owner, set `GOALSET_UID=$(id -u)` and `GOALSET_GID=$(id -g)` in the shell before running Compose.

To run the production-shaped app container locally, after creating `.env.local`:

```bash
docker compose up -d --build goalset-app
```

For a phone on the same trusted private LAN, find the computer's LAN address with `hostname -I` and open `http://<LAN-IP>:3000` on the phone. Compose publishes the Web service on all host interfaces. With `AUTH_DISABLED=true`, no login is required and every reachable client has full access. Do not expose this port to the public Internet; restore authentication and put the service behind HTTPS before WAN access. Service-worker installation and real Push notifications require a secure context (HTTPS, or localhost), so use an HTTPS reverse proxy or private HTTPS network such as Tailscale for PWA notifications.

QQ and PWA workers are opt-in profiles:

```bash
docker compose --profile qq up -d goalset-qq-worker
docker compose --profile pwa up -d goalset-pwa-worker
```

## Optional integrations

### AI

Set `AI_PROVIDER=openai`, `AI_API_KEY` (or `OPENAI_API_KEY`), and `AI_MODEL`. The server sends a bounded schedule context to the configured provider and validates the structured task plan before invoking the deterministic scheduler. `AI_PROVIDER=mock` is available for local integration tests without an external API call.

### QQ Bot

Set `QQBOT_APP_ID`, `QQBOT_APP_SECRET`, and `QQBOT_OWNER_USER_ID`, then run:

```bash
pnpm worker
```

The worker exits clearly when QQ credentials are absent. It accepts only C2C messages from the configured owner identity and reuses the website AI/scheduling service.

### PWA reminders

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`, then run:

```bash
pnpm pwa-worker
```

The browser subscription API and service worker are optional; no fake notification is created when VAPID is not configured.

The Dashboard settings panel can edit the seven weekly availability rules, add one-off unavailable windows, set the task buffer, choose or clear an explicit AI default duration, and enable PWA reminders. Selecting a task exposes recurrence creation and single-occurrence move/skip controls; recurring instances are materialized into the same SQLite schedule when their date is viewed.

The notification menu reads the reminder outbox and exposes failed reminders for retry. QQ messages are claimed by external message ID before parsing, so duplicate official-Bot deliveries do not create duplicate tasks. Website and QQ commands share task creation, status updates, relative dates, and exact-time rescheduling; a reschedule that would move elastic tasks waits for confirmation.

`GET /api/status` also exposes the last worker run/success/error heartbeat; the settings panel shows the PWA worker status and whether QQ credentials are configured.

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
