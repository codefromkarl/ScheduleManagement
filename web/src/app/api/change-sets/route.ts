import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { changeSets } from "@/server/db/schema";

export async function GET() {
  const rows = await getDb().select({ id: changeSets.id, source: changeSets.source, status: changeSets.status, originalCommand: changeSets.originalCommand, createdAt: changeSets.createdAt }).from(changeSets).where(eq(changeSets.workspaceId, "personal")).orderBy(desc(changeSets.createdAt)).limit(10);
  return NextResponse.json({ changes: rows });
}
