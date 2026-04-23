import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ brand: string; id: string }> },
) {
  const { id } = await ctx.params;
  let body: { entry_date?: string; note?: string; screenshots?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.entry_date !== undefined) patch.entry_date = body.entry_date;
  if (body.note !== undefined) patch.note = body.note;
  if (body.screenshots !== undefined) patch.screenshots = body.screenshots;

  const { data, error } = await getSupabaseAdmin()
    .from("report_history")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ brand: string; id: string }> },
) {
  const { id } = await ctx.params;
  const { error } = await getSupabaseAdmin()
    .from("report_history")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
