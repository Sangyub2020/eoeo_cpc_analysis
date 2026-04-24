import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQueryLong } from "@/lib/db/exec";
import { assertIdent, q, sqlLit, buildWhereClause, type FilterShape } from "@/lib/reports/sql";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Drill-down endpoint for the raw search-term report (`sp_raw` kind).
 *
 * The raw table carries full (date × campaign × target × customer_search_term)
 * granularity — potentially tens of millions of rows. Dashboards never touch
 * it; this endpoint is the only read path. With indexes on search_term /
 * target_value, a filter-first query returns in ~100ms regardless of table
 * size.
 *
 * Body: {
 *   filterBy: "search_term" | "target_value";
 *   value: string;
 *   groupBy: "search_term" | "target_value";
 *   // Optional shared filter (date range, campaign selection, etc.)
 *   filter?: FilterShape;
 * }
 *
 * Returns rows aggregated by `groupBy`, ordered by sales desc.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = decodeURIComponent((await ctx.params).brand).trim();
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  let body: {
    filterBy?: "search_term" | "target_value";
    value?: string;
    groupBy?: "search_term" | "target_value";
    filter?: FilterShape;
    limit?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const filterBy = body.filterBy;
  const groupBy = body.groupBy;
  const value = (body.value ?? "").trim();
  const limit = Math.min(body.limit ?? 500, 2000);

  if (filterBy !== "search_term" && filterBy !== "target_value") {
    return NextResponse.json({ error: "filterBy must be 'search_term' or 'target_value'" }, { status: 400 });
  }
  if (groupBy !== "search_term" && groupBy !== "target_value") {
    return NextResponse.json({ error: "groupBy must be 'search_term' or 'target_value'" }, { status: 400 });
  }
  if (!value) {
    return NextResponse.json({ error: "value required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Resolve the raw table for this brand.
  const { data: rtype, error: rtErr } = await supabase
    .from("report_types")
    .select("id, table_name")
    .eq("brand", brand)
    .eq("kind", "sp_raw")
    .maybeSingle();
  if (rtErr) return NextResponse.json({ error: rtErr.message }, { status: 500 });
  if (!rtype) {
    return NextResponse.json(
      {
        error: `이 브랜드에 원본(raw) 레포트가 업로드되지 않아 드릴다운을 할 수 없습니다. 업로드에서 "SP 원본" kind 로 raw 파일을 올려주세요.`,
      },
      { status: 404 },
    );
  }

  // Validate allowed columns
  const { data: cols } = await supabase
    .from("report_columns")
    .select("column_name")
    .eq("report_type_id", rtype.id);
  const allowed = new Set((cols ?? []).map((c) => c.column_name));

  try {
    assertIdent(rtype.table_name, "table name");
    assertIdent(filterBy, "filterBy");
    assertIdent(groupBy, "groupBy");
    if (!allowed.has("search_term") || !allowed.has("target_value")) {
      return NextResponse.json(
        { error: "raw 테이블에 search_term / target_value 컬럼이 없습니다." },
        { status: 500 },
      );
    }

    const extraWhere = buildWhereClause(body.filter ?? {}, allowed);
    // Primary filter always case-sensitive exact match on the indexed column.
    const filterClause =
      `${extraWhere ? `${extraWhere} and` : "where"} ${q(filterBy)} = ${sqlLit(value)}`;

    const sql =
      `select ${q(groupBy)} as v, ` +
      `coalesce(sum(impressions),0)::bigint as impressions, ` +
      `coalesce(sum(clicks),0)::bigint as clicks, ` +
      `coalesce(sum(total_cost),0)::numeric as cost, ` +
      `coalesce(sum(sales),0)::numeric as sales ` +
      `from public.${q(rtype.table_name)} ` +
      `${filterClause} ` +
      `group by ${q(groupBy)} ` +
      `order by sales desc nulls last, cost desc nulls last ` +
      `limit ${limit}`;

    const rows = await execQueryLong<{
      v: string | null;
      impressions: number | null;
      clicks: number | null;
      cost: number | null;
      sales: number | null;
    }>(sql);

    return NextResponse.json({
      rows: rows.map((r) => ({
        value: r.v,
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        cost: Number(r.cost ?? 0),
        sales: Number(r.sales ?? 0),
        roas:
          Number(r.cost ?? 0) > 0 ? Number(r.sales ?? 0) / Number(r.cost ?? 0) : null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "drill failed" },
      { status: 500 },
    );
  }
}
