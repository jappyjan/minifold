import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/server/db";
import { hasAnyAdmin } from "@/server/db/users";
import { hasAnyProvider } from "@/server/db/providers";
import { validateSession } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/cookies";

const PUBLIC_PREFIXES = ["/_next", "/favicon.ico"];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Build the forwarded headers ONCE; reuse for every NextResponse.next() in this proxy.
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("x-pathname", pathname);
  const passThrough = () =>
    NextResponse.next({ request: { headers: forwardedHeaders } });

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return passThrough();
  }

  const db = getDatabase();
  const setupComplete = hasAnyAdmin(db) && hasAnyProvider(db);

  if (!setupComplete) {
    if (pathname === "/setup") return passThrough();
    return NextResponse.redirect(new URL("/setup", req.url));
  }

  if (pathname === "/setup") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Validate the session cookie.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? validateSession(db, token) : null;

  if (!session) {
    if (pathname === "/login") return passThrough();
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", pathname);
    const res = NextResponse.redirect(loginUrl);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // Signed in: bounce away from /login.
  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return passThrough();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
