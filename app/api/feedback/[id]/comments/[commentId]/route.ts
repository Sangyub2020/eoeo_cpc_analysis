import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const { commentId } = await ctx.params;
  const { error } = await getSupabaseAdmin()
    .from("feedback_comments")
    .delete()
    .eq("id", commentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
