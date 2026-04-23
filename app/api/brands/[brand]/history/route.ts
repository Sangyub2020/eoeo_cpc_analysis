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
    .from("report_history")
    .select("*")
    .eq("brand", brand)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  let body: { entry_date?: string; note?: string; screenshots?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    brand,
    report_type_id: null,
    note: (body.note ?? "").trim(),
    screenshots: Array.isArray(body.screenshots) ? body.screenshots : [],
  };
  if (body.entry_date) payload.entry_date = body.entry_date;

  const { data, error } = await getSupabaseAdmin()
    .from("report_history")
    .insert(payload)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}
