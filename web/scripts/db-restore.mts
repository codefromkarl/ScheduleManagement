import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client/node";
import { config } from "dotenv";
import { sqlitePathFromUrl } from "./sqlite-url";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
const inputPath = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!inputPath?.endsWith(".db")) throw new Error("Usage: pnpm db:restore <backup.db>");
if (process.env.GOALSET_RESTORE_CONFIRM !== "1") {
  throw new Error("Stop Goalset app/workers, then set GOALSET_RESTORE_CONFIRM=1 to confirm the destructive restore");
}

const targetPath = sqlitePathFromUrl(databaseUrl);
if (inputPath === targetPath) throw new Error("Backup path must differ from the live database path");

const source = createClient({ url: `file:${inputPath}` });
try {
  const check = await source.execute("PRAGMA quick_check");
  if (check.rows[0]?.[0] !== "ok") throw new Error("Backup failed SQLite quick_check");
} finally {
  source.close();
}

await mkdir(dirname(targetPath), { recursive: true });
const temporaryPath = `${targetPath}.restore-${process.pid}`;
await copyFile(inputPath, temporaryPath);
await rename(temporaryPath, targetPath);
await Promise.all([
  rm(`${targetPath}-wal`, { force: true }),
  rm(`${targetPath}-shm`, { force: true }),
]);
console.log(`Restore applied from ${inputPath}`);
