import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client/node";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryScheduleStore } from "@/features/schedule/data/in-memory-store";
import type { ScheduleTask } from "@/features/schedule/domain/types";
import * as schema from "@/server/db/schema";
import type { QqScheduleProposalIntent, QqScheduleProposalPreview } from "./schedule-proposal-types";
import {
  buildQqProposalPreview,
  cancelQqScheduleProposal,
  claimQqScheduleProposal,
  createQqScheduleProposal,
  findQqScheduleProposal,
  formatQqScheduleProposal,
  markQqScheduleProposalApplied,
  parseQqProposalAction,
  parseQqProposalButtonData,
  qqProposalKeyboard,
  scheduleSnapshotFingerprint,
} from "./schedule-proposals";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function migratedDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "goalset-qq-proposal-"));
  temporaryDirectories.push(directory);
  const client = createClient({ url: `file:${join(directory, "goalset.db")}` });
  const migrationDirectory = new URL("../../../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrationFiles) {
    const migration = await readFile(new URL(name, migrationDirectory), "utf8");
    await client.executeMultiple(migration.replaceAll("--> statement-breakpoint", ""));
  }
  await client.executeMultiple("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return { client, db: drizzle({ client, schema }) };
}

const noSlotPreview: QqScheduleProposalPreview = {
  decision: "no_slot",
  taskTitle: "准备周报",
  date: "2026-08-21",
  durationMinutes: 60,
  moves: [],
  contextBlocks: [],
  crossDate: false,
  occupiedNoSlot: false,
  reasons: ["没有安全空档"],
  baseFingerprint: "fingerprint",
};

const proposalTask: ScheduleTask = { id: "qq-proposal-task", title: "准备周报", date: "2026-08-21", kind: "flexible", status: "todo", priority: "normal", reminderPolicy: "auto", estimatedMinutes: 60, movable: true };
const proposalIntent: QqScheduleProposalIntent = { kind: "insert", task: proposalTask, mode: "rules", originalCommand: "安排一小时准备周报" };

describe("QQ schedule proposal preview", () => {
  it("computes a structured preview without creating a task or block", async () => {
    const store = new InMemoryScheduleStore();
    const before = await store.getSnapshot(proposalTask.date);
    const preview = await buildQqProposalPreview(store, proposalIntent);
    const after = await store.getSnapshot(proposalTask.date);
    expect(preview.taskTitle).toBe(proposalTask.title);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.blocks).toEqual(before.blocks);
    expect(scheduleSnapshotFingerprint([after])).toBe(scheduleSnapshotFingerprint([before]));
    expect(formatQqScheduleProposal("P-1234ABCD", preview)).toContain("确认前尚未创建任务或修改日程");
  });

  it("parses only explicit proposal actions", () => {
    expect(parseQqProposalAction("确认 P-12ab34cd")).toEqual({ action: "confirm", publicId: "P-12AB34CD" });
    expect(parseQqProposalAction("保存到待安排")).toEqual({ action: "save_unplanned", publicId: undefined });
    expect(parseQqProposalAction("取消 P-12AB34CD")).toEqual({ action: "cancel", publicId: "P-12AB34CD" });
    expect(parseQqProposalAction("确认明天的安排")).toBeNull();
    expect(parseQqProposalButtonData("goalset-proposal:confirm:P-12ab34cd")).toEqual({ action: "confirm", publicId: "P-12AB34CD" });
    expect(parseQqProposalButtonData("confirm:P-12AB34CD")).toBeNull();
    expect(qqProposalKeyboard("P-12AB34CD", "auto").content.rows[0].buttons.map((button) => button.render_data.label)).toEqual(["确认安排", "取消"]);
    expect(qqProposalKeyboard("P-12AB34CD", "no_slot").content.rows[0].buttons[0].render_data.label).toBe("保存到待安排");
  });

  it("creates a no-slot task only through the explicit save-unplanned mutation", async () => {
    const store = new InMemoryScheduleStore();
    const task: ScheduleTask = { id: "explicit-unplanned", title: "冲突任务", date: "2026-08-21", kind: "fixed", status: "todo", priority: "normal", reminderPolicy: "auto", estimatedMinutes: 30, movable: false, preferredStartMinutes: 9 * 60 };
    const preview = await store.previewTask(task);
    expect(preview.proposal.decision).toBe("no_slot");
    expect((await store.getSnapshot(task.date)).tasks.some((item) => item.id === task.id)).toBe(false);

    const saved = await store.saveUnplannedTask(task);
    expect(saved.changeSetId).toBeTruthy();
    expect(saved.snapshot.tasks.some((item) => item.id === task.id)).toBe(true);
    expect(saved.snapshot.blocks.some((block) => block.taskId === task.id)).toBe(false);
  });
});

describe("QQ schedule proposal persistence", () => {
  it("supersedes one active proposal, atomically claims once, applies, and expires", async () => {
    const { client, db } = await migratedDatabase();
    try {
      const now = new Date("2026-08-21T06:00:00.000Z");
      await db.insert(schema.workspaces).values({ id: "personal", name: "个人工作区" });
      await db.insert(schema.commandReceipts).values([
        { id: "receipt-1", workspaceId: "personal", channel: "qq", externalMessageId: "message-1", senderId: "owner" },
        { id: "receipt-2", workspaceId: "personal", channel: "qq", externalMessageId: "message-2", senderId: "owner" },
        { id: "receipt-3", workspaceId: "personal", channel: "qq", externalMessageId: "message-3", senderId: "owner" },
      ]);

      const first = await createQqScheduleProposal({ ownerId: "owner", sourceReceiptId: "receipt-1", intent: proposalIntent, preview: noSlotPreview, now, db });
      const second = await createQqScheduleProposal({ ownerId: "owner", sourceReceiptId: "receipt-2", intent: proposalIntent, preview: noSlotPreview, now: new Date(now.getTime() + 1_000), db });
      const [superseded] = await db.select().from(schema.qqScheduleProposals).where(eq(schema.qqScheduleProposals.id, first.proposal.id));
      expect(second.superseded).toBe(1);
      expect(superseded.status).toBe("superseded");
      expect(superseded.activeSlot).toBeNull();
      const [supersededReceipt] = await db.select().from(schema.commandReceipts).where(eq(schema.commandReceipts.id, "receipt-1"));
      expect(supersededReceipt.status).toBe("processed");
      expect(supersededReceipt.responseText).toContain("替代");

      const claims = await Promise.all([
        claimQqScheduleProposal("owner", second.proposal.publicId, new Date(now.getTime() + 2_000), db),
        claimQqScheduleProposal("owner", second.proposal.publicId, new Date(now.getTime() + 2_000), db),
      ]);
      expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
      await db.insert(schema.changeSets).values({ id: "change", workspaceId: "personal", source: "test", beforeState: {}, afterState: {}, status: "applied" });
      const applied = await markQqScheduleProposalApplied(second.proposal.id, "change", new Date(now.getTime() + 3_000), db);
      expect(applied?.status).toBe("applied");
      expect(applied?.activeSlot).toBeNull();

      const expiring = await createQqScheduleProposal({ ownerId: "owner", sourceReceiptId: "receipt-3", intent: proposalIntent, preview: noSlotPreview, now, db });
      const expired = await findQqScheduleProposal("owner", expiring.proposal.publicId, new Date(now.getTime() + 16 * 60_000), db);
      expect(expired?.status).toBe("expired");
      expect(expired?.activeSlot).toBeNull();
      const [expiredReceipt] = await db.select().from(schema.commandReceipts).where(eq(schema.commandReceipts.id, "receipt-3"));
      expect(expiredReceipt.status).toBe("processed");
      expect(await cancelQqScheduleProposal("owner", expiring.proposal.publicId, new Date(now.getTime() + 17 * 60_000), db)).toMatchObject({ status: "expired" });
    } finally {
      client.close();
    }
  });
});
