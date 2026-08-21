import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { changeSets } from "@/server/db/schema";

function csvValue(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const rows = await getDb().select().from(changeSets).where(eq(changeSets.workspaceId, "personal")).orderBy(desc(changeSets.createdAt)).limit(1000);
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const header = ["id", "source", "status", "originalCommand", "createdAt", "parsedIntent", "beforeState", "afterState"];
    const lines = [header.join(","), ...rows.map((row) => [row.id, row.source, row.status, row.originalCommand, row.createdAt, row.parsedIntent, row.beforeState, row.afterState].map(csvValue).join(","))];
    return new NextResponse(`\ufeff${lines.join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=goalset-change-sets.csv" } });
  }
  return NextResponse.json({ exportedAt: new Date().toISOString(), changes: rows }, { headers: { "content-disposition": "attachment; filename=goalset-change-sets.json" } });
}
