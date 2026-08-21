import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { pushSubscriptions, workspaces } from "@/server/db/schema";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Push subscription 无效" } }, { status: 400 });
  const db = getDb();
  await db.insert(workspaces).values({ id: "personal", name: "个人工作区", timezone: "Asia/Shanghai" }).onConflictDoNothing();
  await db.insert(pushSubscriptions).values({ id: crypto.randomUUID(), workspaceId: "personal", endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, userAgent: parsed.data.userAgent }).onConflictDoNothing();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "endpoint is required" } }, { status: 400 });
  const db = getDb();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  return NextResponse.json({ ok: true });
}
