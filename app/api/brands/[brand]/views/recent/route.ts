import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Upsert the per-brand "Recent" view — the auto-saved snapshot of the user's
 * last dashboard state. Lives alongside their named saved views under a
 * reserved name so the user can see + optionally pin it. POST-only so
 * `navigator.sendBeacon` can hit it during page unload.
 */
export const RECENT_VIEW_NAME = "Recent";

function resolveBrand(raw: string): string {
  return decodeURIComponent(raw).trim();
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  let body: { config?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  const { data: existing, error: selErr } = await sb
    .from("brand_views")
    .select("id")
    .eq("brand", brand)
    .eq("name", RECENT_VIEW_NAME)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  if (existing) {
    const { error: upErr } = await sb
      .from("brand_views")
      .update({ config: body.config ?? {}, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ view: { id: existing.id, name: RECENT_VIEW_NAME } });
  }

  const { data, error: insErr } = await sb
    .from("brand_views")
    .insert({ brand, name: RECENT_VIEW_NAME, config: body.config ?? {} })
    .select()
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ view: data });
}
