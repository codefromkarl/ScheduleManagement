import { NextResponse } from "next/server";
import { z } from "zod";
import { authIsConfigured, authIsDisabled, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/server/auth";

const loginSchema = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  if (authIsDisabled()) {
    return NextResponse.json({ ok: true, authDisabled: true });
  }

  if (!authIsConfigured()) {
    return NextResponse.json({ error: { code: "AUTH_NOT_CONFIGURED", message: "认证尚未配置" } }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success || parsed.data.password !== process.env.OWNER_PASSWORD) {
    return NextResponse.json({ error: { code: "INVALID_CREDENTIALS", message: "密码不正确" } }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  const configuredSecure = process.env.AUTH_COOKIE_SECURE;
  const secureCookie = configuredSecure === "true" || (configuredSecure !== "false" && new URL(request.url).protocol === "https:");
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
