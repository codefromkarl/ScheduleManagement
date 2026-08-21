import { readFile, readdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client/node";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "./schema";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SQLite persistence", () => {
  it("round-trips typed data and atomically claims a reminder across clients", async () => {
    const directory = await mkdtemp(join(tmpdir(), "goalset-sqlite-test-"));
    temporaryDirectories.push(directory);
    const databaseUrl = `file:${join(directory, "goalset.db")}`;
    const firstClient = createClient({ url: databaseUrl });
    const secondClient = createClient({ url: databaseUrl });

    try {
      const migrationDirectory = new URL("../../../drizzle/", import.meta.url);
      const migrationFiles = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
      const migrations = await Promise.all(migrationFiles.map((name) => readFile(new URL(name, migrationDirectory), "utf8")));
      for (const migration of migrations) await firstClient.executeMultiple(migration.replaceAll("--> statement-breakpoint", ""));
      await Promise.all([
        firstClient.executeMultiple("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;"),
        secondClient.executeMultiple("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;"),
      ]);
      const firstDb = drizzle({ client: firstClient, schema });
      const secondDb = drizzle({ client: secondClient, schema });
      const scheduledAt = new Date("2026-08-21T02:00:00.000Z");

      await firstDb.insert(schema.workspaces).values({ id: "personal", name: "个人工作区" });
      await firstDb.insert(schema.preferences).values({ id: "preference", workspaceId: "personal", key: "bufferMinutes", value: 15 });
      await firstDb.insert(schema.tasks).values({ id: "task", workspaceId: "personal", title: "提醒测试", date: "2026-08-21", kind: "fixed", estimatedMinutes: 30, movable: false });
      await firstDb.insert(schema.reminders).values({
        id: "reminder",
        workspaceId: "personal",
        kind: "daily_summary",
        channel: "pwa",
        scheduledAt,
        dedupeKey: "daily-summary:test:pwa",
        importanceReasons: ["blocked_task", "impossible_capacity"],
      });

      const [preference] = await firstDb.select().from(schema.preferences);
      const [task] = await firstDb.select().from(schema.tasks);
      const [reminder] = await firstDb.select().from(schema.reminders);
      expect(preference.value).toBe(15);
      expect(task.reminderPolicy).toBe("auto");
      expect(reminder.scheduledAt).toEqual(scheduledAt);
      expect(reminder.importanceReasons).toEqual(["blocked_task", "impossible_capacity"]);

      const claim = (database: typeof firstDb) => database
        .update(schema.reminders)
        .set({ status: "sending", updatedAt: new Date() })
        .where(and(eq(schema.reminders.id, "reminder"), eq(schema.reminders.status, "pending")))
        .returning({ id: schema.reminders.id });
      const claims = await Promise.all([claim(firstDb), claim(secondDb)]);
      expect(claims.flat()).toEqual([{ id: "reminder" }]);

      const integrity = await firstClient.execute("PRAGMA quick_check");
      const foreignKeys = await firstClient.execute("PRAGMA foreign_key_check");
      expect(integrity.rows[0]?.[0]).toBe("ok");
      expect(foreignKeys.rows).toHaveLength(0);
    } finally {
      firstClient.close();
      secondClient.close();
    }
  });
});
