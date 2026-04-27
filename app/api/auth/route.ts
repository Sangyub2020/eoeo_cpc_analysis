import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sign out — clears the Supabase Auth session. Login is handled entirely on
 * the client via supabase.auth.signInWithOAuth({ provider: "google" }) and
 * the /auth/callback route, so this endpoint only needs DELETE.
 */
export async function DELETE() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // ignore — client-side signOut already cleared local state
  }
  return NextResponse.json({ ok: true });
}
