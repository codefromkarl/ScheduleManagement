import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databasePath = resolve(process.cwd(), "data/goalset-e2e.db");
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });

const env = { ...process.env, DATABASE_URL: `file:${databasePath}`, AUTH_DISABLED: "true", AI_PROVIDER: "local", NEXT_TELEMETRY_DISABLED: "1" };
const migrate = spawnSync("./node_modules/.bin/drizzle-kit", ["migrate"], { cwd: process.cwd(), env, stdio: "inherit" });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
