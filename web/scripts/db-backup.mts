import { access, chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client/node";
import { config } from "dotenv";
import { sqlitePathFromUrl } from "./sqlite-url";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sourcePath = sqlitePathFromUrl(databaseUrl);
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outputPath = resolve(process.argv[2] ?? `backups/goalset-${timestamp}.db`);

if (sourcePath === outputPath) throw new Error("Backup path must differ from the live database path");
await mkdir(dirname(outputPath), { recursive: true });
await access(outputPath).then(
  () => { throw new Error(`Refusing to overwrite existing backup: ${outputPath}`); },
  () => undefined,
);

const client = createClient({ url: databaseUrl });
try {
  await client.execute("PRAGMA wal_checkpoint(PASSIVE)");
  await client.execute(`VACUUM INTO '${outputPath.replaceAll("'", "''")}'`);
  await chmod(outputPath, 0o600);
  const backupClient = createClient({ url: `file:${outputPath}` });
  try {
    const result = await backupClient.execute("PRAGMA quick_check");
    if (result.rows[0]?.[0] !== "ok") throw new Error("SQLite backup failed quick_check");
  } finally {
    backupClient.close();
  }
  console.log(`Backup written to ${outputPath}`);
} finally {
  client.close();
}
