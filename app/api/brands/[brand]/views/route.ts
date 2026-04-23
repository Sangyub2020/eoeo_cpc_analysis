import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function resolveBrand(raw: string): string {
  return decodeURIComponent(raw).trim();
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("brand_views")
    .select("*")
    .eq("brand", brand)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ views: data ?? [] });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  let body: { name?: string; config?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from("brand_views")
    .insert({
      brand,
      name,
      config: body.config ?? {},
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ view: data });
}
