import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { reminders } from "@/server/db/schema";

const receiptSchema = z.object({ reminderId: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = receiptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "提醒回执无效" } }, { status: 400 });
  const [reminder] = await getDb().update(reminders).set({ receivedAt: new Date(), updatedAt: new Date() }).where(and(eq(reminders.id, parsed.data.reminderId), eq(reminders.workspaceId, "personal"), eq(reminders.channel, "pwa"), inArray(reminders.status, ["sending", "sent"]))).returning({ id: reminders.id, receivedAt: reminders.receivedAt });
  if (!reminder) return NextResponse.json({ error: { code: "REMINDER_NOT_FOUND", message: "提醒不存在" } }, { status: 404 });
  return NextResponse.json({ reminder });
}
