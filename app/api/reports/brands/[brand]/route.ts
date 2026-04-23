import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * List all report_types under a given brand + their columns, so the brand
 * detail page can render composite charts that query from multiple tables.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const { brand: rawBrand } = await ctx.params;
  const brand = decodeURIComponent(rawBrand).trim();
  if (!brand) {
    return NextResponse.json({ error: "brand required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: types, error } = await supabase
    .from("report_types")
    .select("id, slug, display_name, table_name, key_columns, created_at, brand")
    .eq("brand", brand)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!types?.length) {
    return NextResponse.json({ brand, types: [] });
  }

  const { data: cols } = await supabase
    .from("report_columns")
    .select("report_type_id, id, column_name, source_header, data_type, is_key, position")
    .in(
      "report_type_id",
      types.map((t) => t.id),
    )
    .order("position", { ascending: true });

  const columnsByType = new Map<string, typeof cols>();
  for (const c of cols ?? []) {
    const arr = columnsByType.get(c.report_type_id) ?? [];
    arr.push(c);
    columnsByType.set(c.report_type_id, arr);
  }

  return NextResponse.json({
    brand,
    types: types.map((t) => ({
      type: t,
      columns: columnsByType.get(t.id) ?? [],
    })),
  });
}
