import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type MatchType = "prefix" | "contains" | "regex";
const MATCH_TYPES: MatchType[] = ["prefix", "contains", "regex"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  let body: { match_type?: string; pattern?: string; priority?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const matchType = String(body.match_type ?? "") as MatchType;
  const pattern = String(body.pattern ?? "");
  const priority = Number(body.priority ?? 0);
  if (!MATCH_TYPES.includes(matchType)) {
    return NextResponse.json({ error: "invalid match_type" }, { status: 400 });
  }
  if (!pattern) {
    return NextResponse.json({ error: "pattern required" }, { status: 400 });
  }
  if (matchType === "regex") {
    try {
      new RegExp(pattern);
    } catch (e) {
      return NextResponse.json(
        { error: `invalid regex: ${e instanceof Error ? e.message : e}` },
        { status: 400 },
      );
    }
  }

  const sb = getSupabaseAdmin();
  const { data: brand, error: bErr } = await sb
    .from("brands")
    .select("id")
    .eq("slug", slug)
    .single();
  if (bErr || !brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const { data: rule, error: rErr } = await sb
    .from("brand_rules")
    .insert({
      brand_id: brand.id,
      match_type: matchType,
      pattern,
      priority: Number.isFinite(priority) ? Math.trunc(priority) : 0,
    })
    .select("id, brand_id, match_type, pattern, priority")
    .single();
  if (rErr || !rule) {
    return NextResponse.json(
      { error: rErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ rule });
}
