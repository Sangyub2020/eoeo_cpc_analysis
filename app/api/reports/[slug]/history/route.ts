import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function resolveTypeId(slug: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("report_types")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return data?.id ?? null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const typeId = await resolveTypeId(slug);
  if (!typeId) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data, error } = await getSupabaseAdmin()
    .from("report_history")
    .select("*")
    .eq("report_type_id", typeId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  let body: { entry_date?: string; note?: string; screenshots?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const typeId = await resolveTypeId(slug);
  if (!typeId) return NextResponse.json({ error: "not found" }, { status: 404 });

  const payload: Record<string, unknown> = {
    report_type_id: typeId,
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
