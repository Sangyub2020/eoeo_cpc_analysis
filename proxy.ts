import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate. Google OAuth via Supabase Auth — the only way in. The user
 * signs in on /login, Supabase issues an `sb-…-auth-token` cookie, and
 * this middleware sees the session via @supabase/ssr.
 *
 * `ALLOWED_EMAILS` (comma-separated) restricts who can sign in. Each entry
 * is matched two ways:
 *   - Full email: `ksy@egongegong.com` matches that exact address
 *   - Domain: `@egongegong.com` (or just `egongegong.com`) matches every
 *     email under that domain
 * Empty/unset = any signed-in Google account allowed (relying on Supabase's
 * OAuth client config to limit the audience instead).
 */
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAllowedEmail(email: string | null | undefined): boolean {
  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return true; // no allowlist configured -> any signed-in Google account
  if (!email) return false;
  const lower = email.toLowerCase();
  const at = lower.lastIndexOf("@");
  const userDomain = at >= 0 ? lower.slice(at + 1) : "";

  for (const entryRaw of raw.split(",")) {
    const entry = entryRaw.trim().toLowerCase();
    if (!entry) continue;
    if (entry.startsWith("@")) {
      if (userDomain === entry.slice(1)) return true;
    } else if (!entry.includes("@")) {
      if (userDomain === entry) return true;
    } else {
      if (lower === entry) return true;
    }
  }
  return false;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Auth misconfigured (env vars missing) — open access so the dashboard
  // doesn't lock the user out before they can fix the deployment.
  if (!supabaseUrl || !supabaseAnon) return NextResponse.next();

  // Build the response we'll mutate so Supabase can refresh tokens via cookies.
  const response = NextResponse.next();

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

  // Not authenticated (or signed in but not in allowlist) -> bounce to login.
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
