import { NextResponse, type NextRequest } from "next/server";

/**
 * Simple shared-passcode gate. No per-user accounts — everyone who knows
 * `APP_PASSCODE` gets in and stays in (cookie lasts 30 days).
 *
 * Set `APP_PASSCODE` on Vercel Environment Variables to enable. Leaving it
 * blank disables the gate entirely (useful for local dev).
 */
const AUTH_COOKIE = "ax-auth";
const PUBLIC_PATHS = ["/login", "/api/auth"];

export function proxy(req: NextRequest) {
  const passcode = process.env.APP_PASSCODE;
  // No passcode configured -> gate disabled entirely.
  if (!passcode) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie === "1") return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // run on everything except static assets and Next internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)).*)",
  ],
};
