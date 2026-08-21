import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";

const updateSchema = z.object({ name: z.string().min(1).max(100).optional(), archived: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "项目修改无效" } }, { status: 400 });
  const [project] = await getDb().update(projects).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(projects.id, id), eq(projects.workspaceId, "personal"))).returning();
  if (!project) return NextResponse.json({ error: { code: "PROJECT_NOT_FOUND", message: "项目不存在" } }, { status: 404 });
  return NextResponse.json({ project });
}
