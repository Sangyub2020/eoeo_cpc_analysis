import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQuery } from "@/lib/db/exec";
import { q } from "@/lib/reports/sql";

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

  // Per-type min/max date so the brand dashboard can show a date-range slider
  // bounded by the report's actual data. Each query is cheap (an index-backed
  // min/max), and we fall back to nulls on any error so one bad table doesn't
  // break the whole page.
  const dateRanges = await Promise.all(
    types.map(async (t) => {
      const cols = columnsByType.get(t.id) ?? [];
      const dateCol = cols.find(
        (c) => c.data_type === "date" || c.data_type === "timestamp",
      );
      if (!dateCol) return { type_id: t.id, min: null, max: null };
      try {
        const rows = await execQuery<{ min_date: string | null; max_date: string | null }>(
          `select min(${q(dateCol.column_name)})::text as min_date, max(${q(dateCol.column_name)})::text as max_date from public.${q(t.table_name)}`,
        );
        return {
          type_id: t.id,
          min: rows[0]?.min_date ? rows[0].min_date.slice(0, 10) : null,
          max: rows[0]?.max_date ? rows[0].max_date.slice(0, 10) : null,
        };
      } catch {
        return { type_id: t.id, min: null, max: null };
      }
    }),
  );
  const rangeByType = new Map(dateRanges.map((r) => [r.type_id, r]));

  return NextResponse.json({
    brand,
    types: types.map((t) => {
      const r = rangeByType.get(t.id);
      return {
        type: t,
        columns: columnsByType.get(t.id) ?? [],
        dateRange: r ? { min: r.min, max: r.max } : { min: null, max: null },
      };
    }),
  });
}
