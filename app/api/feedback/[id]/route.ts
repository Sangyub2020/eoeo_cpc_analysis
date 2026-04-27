import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["open", "in_progress", "done", "wontfix"]);

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

/** Verify the signed-in user is the post's author. Returns the existing
 *  post on success, or a NextResponse error to bubble up. */
async function authorizeOwner(id: string) {
  const email = await getRequesterEmail();
  if (!email) {
    return {
      err: NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 }),
    } as const;
  }
  const { data, error } = await getSupabaseAdmin()
    .from("feedback_posts")
    .select("id, author_email")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return {
      err: NextResponse.json({ error: error.message }, { status: 500 }),
    } as const;
  }
  if (!data) {
    return {
      err: NextResponse.json({ error: "not found" }, { status: 404 }),
    } as const;
  }
  // Posts created before author_email existed have null — for safety we
  // treat them as legacy and refuse to mutate (avoids any signed-in user
  // overwriting historical content).
  if (!data.author_email || data.author_email !== email) {
    return {
      err: NextResponse.json(
        { error: "본인이 작성한 글만 수정/삭제할 수 있습니다" },
        { status: 403 },
      ),
    } as const;
  }
  return { email, post: data } as const;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await authorizeOwner(id);
  if ("err" in auth) return auth.err;

  let body: { note?: string; screenshots?: string[]; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  // nickname is no longer user-editable — it's always the author's email.
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
  const auth = await authorizeOwner(id);
  if ("err" in auth) return auth.err;

  const { error } = await getSupabaseAdmin()
    .from("feedback_posts")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
