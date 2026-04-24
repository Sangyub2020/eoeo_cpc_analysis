import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("brand_rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { match_type?: string; pattern?: string; priority?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (body.match_type != null) {
    if (!["prefix", "contains", "regex"].includes(String(body.match_type))) {
      return NextResponse.json({ error: "invalid match_type" }, { status: 400 });
    }
    patch.match_type = body.match_type;
  }
  if (body.pattern != null) {
    const p = String(body.pattern);
    if (!p) return NextResponse.json({ error: "pattern required" }, { status: 400 });
    patch.pattern = p;
  }
  if (body.priority != null) {
    const n = Number(body.priority);
    if (Number.isFinite(n)) patch.priority = Math.trunc(n);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("brand_rules").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
