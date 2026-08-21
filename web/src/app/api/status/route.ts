import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { pushSubscriptions, workerHeartbeats } from "@/server/db/schema";
import { pwaIsConfigured, qqIsConfigured, selectedReminderChannels } from "@/server/qq/config";
import { authIsDisabled } from "@/server/auth";

export async function GET() {
  const [workers, subscriptions] = process.env.DATABASE_URL ? await Promise.all([
    getDb().select({ workerName: workerHeartbeats.workerName, status: workerHeartbeats.status, lastRunAt: workerHeartbeats.lastRunAt, lastSuccessAt: workerHeartbeats.lastSuccessAt, lastError: workerHeartbeats.lastError }).from(workerHeartbeats).where(eq(workerHeartbeats.workspaceId, "personal")).catch(() => []),
    getDb().select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.workspaceId, "personal")).catch(() => []),
  ]) : [[], []];
  return NextResponse.json({
    authDisabled: authIsDisabled(),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    aiConfigured: ["local", "mock"].includes(process.env.AI_PROVIDER ?? "") || Boolean(process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY),
    aiMode: process.env.AI_PROVIDER ?? (process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ? "openai" : "unconfigured"),
    qqConfigured: qqIsConfigured(),
    pwaConfigured: pwaIsConfigured(),
    reminderChannels: selectedReminderChannels(),
    pwaPublicKey: process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    pwaSubscriptionCount: subscriptions.length,
    workers,
  });
}
