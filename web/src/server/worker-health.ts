import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { workerHeartbeats } from "@/server/db/schema";

const WORKSPACE_ID = "personal";

export async function recordWorkerHealth(workerName: string, status: "starting" | "running" | "success" | "error" | "stopped", error?: string) {
  const now = new Date();
  const current = await getDb().select({ id: workerHeartbeats.id }).from(workerHeartbeats).where(eq(workerHeartbeats.id, `${WORKSPACE_ID}:${workerName}`));
  const values = { id: `${WORKSPACE_ID}:${workerName}`, workspaceId: WORKSPACE_ID, workerName, status, lastRunAt: now, lastSuccessAt: status === "success" ? now : undefined, lastError: error ?? null, updatedAt: now };
  if (current.length === 0) {
    await getDb().insert(workerHeartbeats).values({ ...values, lastStartedAt: status === "starting" ? now : undefined });
  } else {
    await getDb().update(workerHeartbeats).set(values).where(eq(workerHeartbeats.id, `${WORKSPACE_ID}:${workerName}`));
  }
}
