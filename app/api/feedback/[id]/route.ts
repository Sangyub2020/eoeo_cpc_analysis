import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["open", "in_progress", "done", "wontfix"]);

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
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
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.nickname !== undefined) {
    const n = String(body.nickname).trim();
    if (!n) return NextResponse.json({ error: "nickname cannot be empty" }, { status: 400 });
    patch.nickname = n;
  }
  if (body.note !== undefined) {
    const n = String(body.note).trim();
    if (!n) return NextResponse.json({ error: "note cannot be empty" }, { status: 400 });
    patch.note = n;
  }
  if (body.screenshots !== undefined) patch.screenshots = body.screenshots;
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: `invalid status: ${body.status}` }, { status: 400 });
    }
    patch.status = body.status;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("feedback_posts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { error } = await getSupabaseAdmin()
    .from("feedback_posts")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
