import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

type GoalsetDatabase = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  goalsetSqliteClient?: Client;
  goalsetDb?: GoalsetDatabase;
  goalsetDbReady?: Promise<void>;
};

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for SQLite persistence");
  if (!url.startsWith("file:")) throw new Error("DATABASE_URL must be a local file: URL for SQLite persistence");
  return url;
}

export function getDb() {
  if (globalForDb.goalsetDb) return globalForDb.goalsetDb;

  const client = createClient({ url: databaseUrl() });
  const db = drizzle({ client, schema });
  globalForDb.goalsetSqliteClient = client;
  globalForDb.goalsetDb = db;
  const ready = client.executeMultiple(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `).then(() => undefined);
  ready.catch((error) => {
    console.error("[goalset-db] SQLite initialization failed", error instanceof Error ? error.message : error);
  });
  globalForDb.goalsetDbReady = ready;
  return db;
}

export async function waitForDb() {
  getDb();
  await globalForDb.goalsetDbReady;
}

export type GoalsetDb = ReturnType<typeof getDb>;
