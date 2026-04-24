import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: { nickname?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nickname = (body.nickname ?? "").trim();
  const note = (body.note ?? "").trim();
  if (!nickname) return NextResponse.json({ error: "nickname required" }, { status: 400 });
  if (!note) return NextResponse.json({ error: "note required" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("feedback_comments")
    .insert({ post_id: id, nickname, note })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}
