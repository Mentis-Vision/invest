import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.(css|js|map|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|otf)$/i.test(pathname)
  );
}

/**
 * Only /app/* and app-only API routes require auth.
 * Everything else (marketing pages, /sign-in, /sign-up, /api/auth, /api/waitlist,
 * /api/cron/*, /snaptrade/callback) is public.
 */
function requiresAuth(pathname: string): boolean {
  if (pathname.startsWith("/app")) return true;
  if (pathname.startsWith("/api/research")) return true;
  if (pathname.startsWith("/api/strategy")) return true;
  if (pathname.startsWith("/api/portfolio-review")) return true;
  // SnapTrade + alerts + user-profile + warehouse/ticker routes do their
  // own auth.api.getSession check, but proxy-gating means 401 races reroute
  // cleanly to /sign-in instead of leaving a signed-out user stuck on
  // blank app views.
  if (pathname.startsWith("/api/snaptrade")) return true;
  if (pathname.startsWith("/api/alerts")) return true;
  if (pathname.startsWith("/api/user/")) return true;
  if (pathname.startsWith("/api/warehouse/")) return true;
  if (pathname.startsWith("/api/options/")) return true;
  if (pathname.startsWith("/api/market-news")) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname) || !requiresAuth(pathname)) {
    return NextResponse.next();
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
