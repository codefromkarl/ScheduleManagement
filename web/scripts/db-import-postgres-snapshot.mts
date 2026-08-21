import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient, type InValue } from "@libsql/client/node";
import { config } from "dotenv";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
const inputPath = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!databaseUrl?.startsWith("file:")) throw new Error("A SQLite file: DATABASE_URL is required");
if (!inputPath?.endsWith(".json")) throw new Error("Usage: pnpm db:import-postgres <snapshot.json>");

type Snapshot = { tables: Record<string, Array<Record<string, unknown>>> };
const snapshot = JSON.parse(await readFile(inputPath, "utf8")) as Snapshot;
const tableOrder = [
  "workspaces",
  "projects",
  "tasks",
  "schedule_blocks",
  "availability_rules",
  "unavailable_windows",
  "recurrence_rules",
  "occurrence_overrides",
  "preferences",
  "change_sets",
  "reminders",
  "channel_identities",
  "command_receipts",
  "worker_heartbeats",
  "push_subscriptions",
] as const;
const booleanColumns = new Set(["archived", "movable", "enabled"]);
const dateColumns = new Set([
  "tasks.date",
  "schedule_blocks.date",
  "unavailable_windows.date",
  "recurrence_rules.start_date",
  "recurrence_rules.end_date",
  "occurrence_overrides.occurrence_date",
]);
const jsonColumns = new Set([
  "recurrence_rules.weekdays",
  "preferences.value",
  "change_sets.parsed_intent",
  "change_sets.before_state",
  "change_sets.after_state",
  "command_receipts.payload",
  "worker_heartbeats.metadata",
]);

function sqliteValue(table: string, column: string, value: unknown): InValue {
  if (value === null || value === undefined) return null;
  if (column.endsWith("_at")) return new Date(String(value)).getTime();
  if (dateColumns.has(`${table}.${column}`)) return String(value).slice(0, 10);
  if (booleanColumns.has(column)) return value ? 1 : 0;
  if (jsonColumns.has(`${table}.${column}`)) return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  throw new Error(`Unsupported ${table}.${column} value in PostgreSQL snapshot`);
}

const client = createClient({ url: databaseUrl });
try {
  await client.executeMultiple("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const existing = await client.execute("select count(*) as count from workspaces");
  if (Number(existing.rows[0]?.count ?? 0) !== 0) {
    throw new Error("SQLite database is not empty; refusing to duplicate PostgreSQL data");
  }

  const transaction = await client.transaction("write");
  try {
    for (const table of tableOrder) {
      for (const row of snapshot.tables[table] ?? []) {
        const columns = Object.keys(row);
        const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        await transaction.execute({
          sql: `insert into "${table}" (${quotedColumns}) values (${placeholders})`,
          args: columns.map((column) => sqliteValue(table, column, row[column])),
        });
      }
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  const check = await client.execute("PRAGMA foreign_key_check");
  if (check.rows.length !== 0) throw new Error("Imported data failed SQLite foreign_key_check");
  console.log(`Imported PostgreSQL snapshot from ${inputPath}`);
} finally {
  client.close();
}
