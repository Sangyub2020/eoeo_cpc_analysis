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
    .from("report_views")
    .select("*")
    .eq("report_type_id", typeId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ views: data ?? [] });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  let body: { name?: string; config?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const typeId = await resolveTypeId(slug);
  if (!typeId) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data, error } = await getSupabaseAdmin()
    .from("report_views")
    .insert({
      report_type_id: typeId,
      name,
      config: body.config ?? {},
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ view: data });
}
