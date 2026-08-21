import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
