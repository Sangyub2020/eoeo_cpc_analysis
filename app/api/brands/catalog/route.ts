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
 * Slugify a display name into a valid `[a-z][a-z0-9_]*` identifier. Strips
 * non-alphanumerics, lowercases, and prepends `b_` if the result starts with
 * a digit so it matches the SLUG_RE constraint.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  if (!base) return "";
  return /^[a-z]/.test(base) ? base : `b_${base}`;
}

/**
 * Create a brand. The user only supplies `display_name`; the internal slug
 * is auto-derived (collisions get a numeric suffix). A case-insensitive
 * `contains` rule on the display_name is also created so any campaign whose
 * name contains the brand routes to it. User can edit/add rules later.
 */
export async function POST(req: Request) {
  let body: { display_name?: string; default_pattern?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const displayName = String(body.display_name ?? "").trim();
  if (!displayName) {
    return NextResponse.json({ error: "display_name required" }, { status: 400 });
  }
  const baseSlug = slugify(displayName);
  if (!SLUG_RE.test(baseSlug)) {
    return NextResponse.json(
      { error: "이름에 alphanumeric 글자가 최소 한 개 필요합니다" },
      { status: 400 },
    );
  }

  const sb = getSupabaseAdmin();

  // Resolve a unique slug — try base, then base_2, base_3, ... up to 50.
  let slug = baseSlug;
  for (let n = 2; n <= 50; n++) {
    const { data: dup } = await sb
      .from("brands")
      .select("slug")
      .eq("slug", slug)
      .maybeSingle();
    if (!dup) break;
    slug = `${baseSlug}_${n}`;
    if (n === 50) {
      return NextResponse.json(
        { error: "slug 충돌 — 다른 이름을 시도해주세요" },
        { status: 409 },
      );
    }
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
