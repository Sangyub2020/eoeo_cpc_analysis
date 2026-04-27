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

/** Comments: only the author may delete their own. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const email = await getRequesterEmail();
  if (!email) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const { commentId } = await ctx.params;
  const sb = getSupabaseAdmin();
  const { data, error: selErr } = await sb
    .from("feedback_comments")
    .select("id, author_email")
    .eq("id", commentId)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!data.author_email || data.author_email !== email) {
    return NextResponse.json(
      { error: "본인이 작성한 댓글만 삭제할 수 있습니다" },
      { status: 403 },
    );
  }

  const { error } = await sb
    .from("feedback_comments")
    .delete()
    .eq("id", commentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
