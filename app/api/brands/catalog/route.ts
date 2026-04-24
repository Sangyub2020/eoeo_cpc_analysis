import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SLUG_RE = /^[a-z][a-z0-9_]{0,62}$/;

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data: brands, error: bErr } = await sb
    .from("brands")
    .select("id, slug, display_name, created_at")
    .order("display_name");
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const { data: rules, error: rErr } = await sb
    .from("brand_rules")
    .select("id, brand_id, match_type, pattern, priority")
    .order("priority", { ascending: false });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  return NextResponse.json({ brands: brands ?? [], rules: rules ?? [] });
}

/**
 * Create a brand. Auto-creates a case-insensitive `contains` rule on the
 * display_name so any campaign whose name contains the brand (in any case)
 * gets routed here. User can edit/add rules later.
 */
export async function POST(req: Request) {
  let body: { slug?: string; display_name?: string; default_pattern?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const slug = String(body.slug ?? "").trim();
  const displayName = String(body.display_name ?? "").trim();
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: `invalid slug: must match ${SLUG_RE}` },
      { status: 400 },
    );
  }
  if (!displayName) {
    return NextResponse.json({ error: "display_name required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: dup } = await sb
    .from("brands")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (dup) {
    return NextResponse.json({ error: "slug already exists" }, { status: 409 });
  }

  const { data: inserted, error: iErr } = await sb
    .from("brands")
    .insert({ slug, display_name: displayName })
    .select("id, slug, display_name")
    .single();
  if (iErr || !inserted) {
    return NextResponse.json(
      { error: iErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  const defaultPattern =
    (body.default_pattern ?? "").trim() || displayName;
  if (defaultPattern) {
    await sb.from("brand_rules").insert({
      brand_id: inserted.id,
      match_type: "contains",
      pattern: defaultPattern,
      priority: 0,
    });
  }

  return NextResponse.json({ brand: inserted });
}
