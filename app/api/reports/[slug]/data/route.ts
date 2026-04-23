import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQueryLong } from "@/lib/db/exec";
import { assertIdent, q } from "@/lib/reports/sql";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10000", 10), 100000);

  const supabase = getSupabaseAdmin();
  const { data: type, error: typeErr } = await supabase
    .from("report_types")
    .select("id, table_name")
    .eq("slug", slug)
    .single();
  if (typeErr || !type) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: columns, error: colErr } = await supabase
    .from("report_columns")
    .select("column_name, source_header, data_type, is_key, position")
    .eq("report_type_id", type.id)
    .order("position", { ascending: true });
  if (colErr) {
    return NextResponse.json({ error: colErr.message }, { status: 500 });
  }

  try {
    assertIdent(type.table_name, "table name");
    const selectList =
      columns && columns.length ? columns.map((c) => q(c.column_name)).join(", ") : "*";
    const rows = await execQueryLong<Record<string, unknown>>(
      `select ${selectList} from public.${q(type.table_name)} limit ${limit}`,
    );
    return NextResponse.json({
      columns: columns ?? [],
      rows,
      rowCount: rows.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "query failed" },
      { status: 500 },
    );
  }
}
