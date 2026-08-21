# Directory Structure

```text
web/
├── src/app/api/             # authenticated route handlers and boundary schemas
├── src/server/db/           # SQLite/LibSQL connection, Drizzle schema, seed entrypoint
├── src/server/ai/           # provider adapters and structured model output
├── src/server/qq/           # QQ configuration and channel boundary
├── src/server/worker.mts    # official QQ worker
├── src/server/pwa-worker.mts# Web Push worker
├── src/features/schedule/   # domain, SQLite/in-memory repository adapters, contracts
└── drizzle/                 # generated SQL migrations
```

Routes validate and authenticate, services coordinate, domain functions decide, and repositories persist. No React component imports Drizzle tables.
