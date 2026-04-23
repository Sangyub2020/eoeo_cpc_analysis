import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execSQL } from "@/lib/db/exec";
import { assertIdent, q } from "@/lib/reports/sql";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const supabase = getSupabaseAdmin();

  const { data: type, error: typeErr } = await supabase
    .from("report_types")
    .select("*")
    .eq("slug", slug)
    .single();

  if (typeErr || !type) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: columns, error: colErr } = await supabase
    .from("report_columns")
    .select("*")
    .eq("report_type_id", type.id)
    .order("position", { ascending: true });

  if (colErr) {
    return NextResponse.json({ error: colErr.message }, { status: 500 });
  }

  return NextResponse.json({ type, columns: columns ?? [] });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const supabase = getSupabaseAdmin();

  const { data: type, error: typeErr } = await supabase
    .from("report_types")
    .select("id, table_name")
    .eq("slug", slug)
    .single();

  if (typeErr || !type) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    assertIdent(type.table_name, "table name");
    await execSQL(`drop table if exists public.${q(type.table_name)} cascade;`);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "drop failed" },
      { status: 500 },
    );
  }

  const { error: delErr } = await supabase
    .from("report_types")
    .delete()
    .eq("id", type.id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
