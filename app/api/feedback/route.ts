import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["open", "in_progress", "done", "wontfix"]);

/** List all feedback posts, newest first. */
export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("feedback_posts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

/** Create a new feedback post. Nickname + note are required. */
export async function POST(req: Request) {
  let body: {
    nickname?: string;
    note?: string;
    screenshots?: string[];
    status?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nickname = (body.nickname ?? "").trim();
  const note = (body.note ?? "").trim();
  if (!nickname) {
    return NextResponse.json({ error: "nickname required" }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ error: "note required" }, { status: 400 });
  }
  const status = body.status && VALID_STATUSES.has(body.status) ? body.status : "open";

  const { data, error } = await getSupabaseAdmin()
    .from("feedback_posts")
    .insert({
      nickname,
      note,
      screenshots: Array.isArray(body.screenshots) ? body.screenshots : [],
      status,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}
