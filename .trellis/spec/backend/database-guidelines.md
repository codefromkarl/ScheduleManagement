# Database Guidelines

## Scenario: Single-file SQLite persistence

### 1. Scope / Trigger

- SQLite is the durable store for the single private workspace. This contract applies to schema, repositories, migrations, app/worker deployment, backup, restore, and PostgreSQL-to-SQLite imports.
- The project chose a local SQLite file because Goalset is a single-user, single-host service. The Web app, QQ worker, and PWA worker share the same bind-mounted file rather than operating a separate database service.
- Drizzle schema source lives in `web/src/server/db/schema.ts`; SQLite migrations live in `web/drizzle/`.

### 2. Signatures

```text
DATABASE_URL=file:./data/goalset.db     # host commands
DATABASE_URL=file:/data/goalset.db      # Compose services

pnpm db:check
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:backup [backups/name.db]
GOALSET_RESTORE_CONFIRM=1 pnpm db:restore <backups/name.db>
pnpm db:import-postgres <snapshot.json>
```

`getDb()` returns the shared Drizzle LibSQL adapter. It accepts only a local `file:` URL. The in-memory schedule store remains a no-database development fallback only when `DATABASE_URL` is intentionally absent.

### 3. Contracts

- Use `drizzle-orm/sqlite-core` and `drizzle-orm/libsql` with `@libsql/client/node`; do not add a network database service for the personal deployment.
- Each process configures `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, and `synchronous=NORMAL` before business writes.
- Compose bind-mounts `web/data` at `/data` for the app and optional workers. `GOALSET_UID` and `GOALSET_GID` must match the host directory owner so every process can create the WAL/SHM files.
- `.dockerignore` must exclude `data` and `backups`; real schedules and database snapshots must never be copied into an image layer.
- Store calendar keys as `TEXT` in exact `YYYY-MM-DD` form. PostgreSQL snapshot imports must strip any ISO time suffix from former `date` columns.
- Store timestamps as integer epoch milliseconds using Drizzle `timestamp_ms`, booleans as SQLite integers with boolean mapping, and structured values as JSON text columns.
- Use transactions for a schedule mutation plus its block, ChangeSet, and reminder records. SQLite has one writer, so transactions must stay short and must not include provider/network calls.
- Use explicit workspace filters on every user-owned query. Keep task identity separate from schedule placement identity.
- `db:backup` uses SQLite `VACUUM INTO`, immediately restricts the output to mode `0600`, and verifies the result with `PRAGMA quick_check`. Restore requires stopped app/workers and the explicit confirmation variable.
- `db:seed` is the only command allowed to create demo tasks. API reads must never seed or mutate demo data.
- Reminder dispatch claims `pending` rows with an atomic conditional update; duplicate QQ input is guarded by the unique `(channel, externalMessageId)` receipt index.
- The no-database in-memory store is a development fallback, not a reduced domain implementation. Its cross-date schedule/reschedule/undo projections must match SQLite even though persistence mechanics differ.
- Multi-day Dashboard reads use `ScheduleStore.getSnapshots(dates)`. SQLite queries each range-owned table once, builds a task lookup Map for block projection, and preserves requested date order; do not implement a range by looping over `getSnapshot()`.
- Query indexes must follow actual filters and ordering. The current baseline covers workspace/date schedule reads, workspace/weekday availability, recurrence lookup, due reminder delivery, recent reminder/ChangeSet ordering, and pending QQ confirmation lookup. Generate every index change as a Drizzle migration and validate it on a temporary database before deployment.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing `DATABASE_URL` in database code | Fail clearly; do not return an empty schedule. |
| Non-`file:` `DATABASE_URL` | Reject it; the active adapter is local SQLite only. |
| Migration mismatch | `db:check` or `db:migrate` fails visibly before app startup. |
| SQLite file or directory is read-only | Compose health fails and app/worker logs the database error; fix `GOALSET_UID`/`GOALSET_GID`, never fall back to memory. |
| Busy concurrent writer | Wait up to the configured busy timeout, then expose the database failure; do not retry an unbounded transaction. |
| Schedule conflict | Roll back the mutation and return a proposal/conflict status. |
| Duplicate reminder or QQ message | Unique indexes and atomic claims prevent a second effect. |
| PostgreSQL snapshot contains ISO timestamps in date columns | Import exactly the first ten `YYYY-MM-DD` characters. |
| Backup integrity failure | Fail `db:backup`; do not report the file as usable. |
| Backup file is group/world-readable | Restrict it to `0600`; private task data must not inherit a permissive umask. |
| Restore without explicit confirmation | Refuse before replacing the live file. |
| Foreign-key violation | Fail the transaction/import and require `PRAGMA foreign_key_check` to return zero rows. |

### 5. Good / Base / Bad Cases

- Good: the app and PWA worker share `data/goalset.db`, one worker wins an atomic reminder claim, API reads still see all tasks, and `quick_check`/`foreign_key_check` pass.
- Base: one app process uses SQLite while optional workers are stopped; WAL remains enabled and backup works online.
- Bad: mounting separate database files into each container, copying only the live `.db` file while WAL writes continue, storing dates as ISO timestamps, or running the container under an owner that cannot create `-wal`/`-shm` files.

### 6. Tests Required

- Run `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, and `pnpm db:check`.
- The SQLite integration test must assert JSON/timestamp round trips, exactly one winner for two concurrent reminder claims, `quick_check = ok`, and zero foreign-key violations.
- A migration/import rehearsal must compare all 15 PostgreSQL table counts with SQLite and then verify an API date query returns the imported tasks/blocks.
- A backup/restore rehearsal must restore into a temporary file, pass `quick_check`, and preserve the task count.
- Focused adapter tests must compare cross-date placement/reschedule origin removal, target insertion, task-date updates, and undo restoration for the in-memory fallback; SQLite API/browser tests cover the durable equivalent.
- Range projection tests must assert requested ordering for both adapters; `pnpm db:check` plus a temporary `db:migrate` must include every generated index migration.
- Compose acceptance must prove the app is healthy, the PWA worker can write its heartbeat through the shared file, and `/api/status` plus `/api/schedule` return real SQLite data.

### 7. Wrong vs Correct

#### Wrong

```ts
const client = createClient({ url: process.env.DATABASE_URL! });
// Starts queries without the SQLite concurrency and integrity pragmas.
```

```yaml
volumes:
  - app-data:/data
# Worker uses a different volume or file and silently sees different state.
```

#### Correct

```ts
const client = createClient({ url: process.env.DATABASE_URL! });
await client.executeMultiple(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);
```

```yaml
environment:
  DATABASE_URL: file:/data/goalset.db
volumes:
  - ./data:/data
```
