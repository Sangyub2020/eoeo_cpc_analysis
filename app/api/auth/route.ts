import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { passcode } = (await req.json().catch(() => ({}))) as { passcode?: string };
  const expected = process.env.APP_PASSCODE;
  if (!expected) {
    return NextResponse.json({ ok: true, note: "gate disabled" });
  }
  if (passcode !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ax-auth", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

/**
 * Sign out — clears both the legacy passcode cookie and the Supabase Auth
 * session so the user goes back to a clean login page regardless of which
 * gate let them in.
 */
export async function DELETE() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // ignore — we still clear the passcode cookie below
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ax-auth", "", { path: "/", maxAge: 0 });
  return res;
}
