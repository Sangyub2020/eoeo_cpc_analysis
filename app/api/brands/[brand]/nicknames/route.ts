import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function resolveBrand(raw: string): string {
  return decodeURIComponent(raw).trim();
}

/** GET: list all campaign → nickname mappings for this brand. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("campaign_nicknames")
    .select("campaign_name, nickname")
    .eq("brand", brand);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ nicknames: data ?? [] });
}

/**
 * PUT: upsert or delete. Body: { campaign_name, nickname }.
 * An empty/whitespace nickname removes the mapping for that campaign.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  let body: { campaign_name?: string; nickname?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const campaignName = (body.campaign_name ?? "").trim();
  if (!campaignName) {
    return NextResponse.json({ error: "campaign_name required" }, { status: 400 });
  }
  const nickname = (body.nickname ?? "").trim();

  const supabase = getSupabaseAdmin();
  if (!nickname) {
    const { error } = await supabase
      .from("campaign_nicknames")
      .delete()
      .eq("brand", brand)
      .eq("campaign_name", campaignName);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const { data, error } = await supabase
    .from("campaign_nicknames")
    .upsert(
      {
        brand,
        campaign_name: campaignName,
        nickname,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "brand,campaign_name" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ nickname: data });
}
