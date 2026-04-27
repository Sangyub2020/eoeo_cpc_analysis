import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate. Two ways in:
 *
 *  1. Google OAuth via Supabase Auth — primary. The user signs in on
 *     /login, Supabase issues an `sb-…-auth-token` cookie, and this
 *     middleware sees the session via @supabase/ssr.
 *  2. Legacy shared-passcode gate (`APP_PASSCODE` env var). Kept as a
 *     fallback so the dashboard still works if the Supabase Auth setup
 *     ever breaks. Disabled when the env var is empty.
 *
 * If `ALLOWED_EMAILS` is set (comma-separated list), Supabase sessions
 * whose `user.email` isn't in that list are bounced to /login. Useful for
 * a personal/team dashboard where you don't want every Google account in
 * the world to be allowed in.
 */
const PASSCODE_COOKIE = "ax-auth";
const PUBLIC_PATHS = ["/login", "/api/auth", "/auth/callback"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAllowedEmail(email: string | null | undefined): boolean {
  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return true; // no allowlist configured -> any signed-in Google account
  if (!email) return false;
  const allowed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const passcodeConfigured = !!process.env.APP_PASSCODE;

  // Both gates disabled -> open access (e.g. local dev with no env vars).
  if (!supabaseUrl || !supabaseAnon) {
    if (!passcodeConfigured) return NextResponse.next();
  }

  // Build the response we'll mutate so Supabase can refresh tokens via cookies.
  const response = NextResponse.next();

  // Try Supabase session first.
  if (supabaseUrl && supabaseAnon) {
    const supabase = createServerClient(supabaseUrl, supabaseAnon, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && isAllowedEmail(user.email)) {
      return response;
    }
    // Signed in but not in allowlist -> treat as anonymous (will redirect below).
  }

  // Legacy passcode fallback.
  if (passcodeConfigured) {
    const cookie = req.cookies.get(PASSCODE_COOKIE)?.value;
    if (cookie === "1") return response;
  }

  // Not authenticated -> bounce to login.
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
