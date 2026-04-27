import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { data, error } = await getSupabaseAdmin()
    .from("feedback_comments")
    .select("*")
    .eq("post_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comments: data ?? [] });
}

/** Anyone signed in can comment. Author = signed-in user's email. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const email = await getRequesterEmail();
  if (!email) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: { note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const note = (body.note ?? "").trim();
  if (!note) return NextResponse.json({ error: "note required" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("feedback_comments")
    .insert({ post_id: id, nickname: email, author_email: email, note })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}
