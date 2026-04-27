import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["open", "in_progress", "done", "wontfix"]);

/** Resolve the signed-in user's email — used as both `nickname` (display)
 *  and `author_email` (ownership) on a new post. Null when no session. */
async function getRequesterEmail(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
  }
}

/** List all feedback posts, newest first. */
export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("feedback_posts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

/** Create a new feedback post. Author is the signed-in user — nickname
 *  field on the body is ignored, the post is always tagged with the
 *  authenticated email. */
export async function POST(req: Request) {
  const email = await getRequesterEmail();
  if (!email) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  let body: { note?: string; screenshots?: string[]; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const note = (body.note ?? "").trim();
  if (!note) return NextResponse.json({ error: "note required" }, { status: 400 });
  const status = body.status && VALID_STATUSES.has(body.status) ? body.status : "open";

  const { data, error } = await getSupabaseAdmin()
    .from("feedback_posts")
    .insert({
      nickname: email,
      author_email: email,
      note,
      screenshots: Array.isArray(body.screenshots) ? body.screenshots : [],
      status,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}
