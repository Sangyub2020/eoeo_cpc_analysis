import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * OAuth callback for Supabase Auth. The Supabase JS client redirects here
 * after Google sign-in with `?code=…`; we exchange the code for a session
 * (which sets the `sb-…-auth-token` cookies) and bounce to `next` (or /reports).
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error_description") ?? searchParams.get("error");
  const next = searchParams.get("next") || "/reports";

  if (error) {
    const url = new URL("/login", origin);
    url.searchParams.set("oauth_error", error);
    return NextResponse.redirect(url);
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error: xerr } = await supabase.auth.exchangeCodeForSession(code);
    if (xerr) {
      const url = new URL("/login", origin);
      url.searchParams.set("oauth_error", xerr.message);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
