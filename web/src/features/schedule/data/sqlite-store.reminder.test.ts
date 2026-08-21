import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/server/db/schema";
import { SqliteScheduleStore } from "./sqlite-store";

const temporaryDirectories: string[] = [];

async function migrate(databaseUrl: string) {
  const client = createClient({ url: databaseUrl });
  const migrationDirectory = new URL("../../../../drizzle/", import.meta.url);
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  try {
    for (const name of files) {
      const sql = await readFile(new URL(name, migrationDirectory), "utf8");
      await client.executeMultiple(sql.replaceAll("--> statement-breakpoint", ""));
    }
  } finally {
    client.close();
  }
}

afterEach(async () => {
  const globalForDb = globalThis as unknown as { goalsetSqliteClient?: Client; goalsetDb?: unknown; goalsetDbReady?: Promise<void> };
  globalForDb.goalsetSqliteClient?.close();
  delete globalForDb.goalsetSqliteClient;
  delete globalForDb.goalsetDb;
  delete globalForDb.goalsetDbReady;
  delete process.env.DATABASE_URL;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SqliteScheduleStore reminder policy persistence", () => {
  it("inherits a recurrence template reminder policy when materializing an occurrence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "goalset-reminder-recurrence-"));
    temporaryDirectories.push(directory);
    const databaseUrl = `file:${join(directory, "goalset.db")}`;
    process.env.DATABASE_URL = databaseUrl;
    await migrate(databaseUrl);

    const client = createClient({ url: databaseUrl });
    const db = drizzle({ client, schema });
    await db.insert(schema.workspaces).values({ id: "personal", name: "个人工作区" });
    await db.insert(schema.tasks).values({ id: "template", workspaceId: "personal", title: "重复重要提醒", date: "2026-08-21", kind: "flexible", status: "todo", priority: "normal", reminderPolicy: "always", estimatedMinutes: 30, movable: true, preferredStartMinutes: 9 * 60 });
    await db.insert(schema.recurrenceRules).values({ id: "rule", taskId: "template", frequency: "daily", startDate: "2026-08-21" });
    client.close();

    const snapshot = await new SqliteScheduleStore().getSnapshot("2026-08-22");
    expect(snapshot.tasks.find((task) => task.id === "template@2026-08-22")?.reminderPolicy).toBe("always");
  });
});
