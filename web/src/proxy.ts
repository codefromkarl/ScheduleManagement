import { NextRequest, NextResponse } from "next/server";
import { authIsDisabled, SESSION_COOKIE, verifySessionToken } from "@/server/auth";

const publicPaths = ["/login", "/api/auth", "/manifest.webmanifest", "/sw.js", "/icon.svg", "/favicon.ico"];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (authIsDisabled()) {
    if (pathname === "/login") {
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = "/";
      homeUrl.search = "";
      return NextResponse.redirect(homeUrl);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next/") || publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const authenticated = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
