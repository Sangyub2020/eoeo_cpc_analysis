import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQueryLong } from "@/lib/db/exec";
import { assertIdent, buildWhereClause, q, sqlLit, type FilterShape } from "@/lib/reports/sql";

export const runtime = "nodejs";

type AggFn = "sum" | "avg" | "min" | "max" | "count";
const AGG_FNS: Set<AggFn> = new Set(["sum", "avg", "min", "max", "count"]);

/**
 * Return distinct values + counts for a column, respecting the other filters.
 * Optionally also aggregates a metric per value (used in the Chart's dimension
 * filters so users can see e.g. "kahi  140행 · Sales 12,345").
 *
 * Body: {
 *   column: string;
 *   filter?: FilterShape;
 *   query?: string;
 *   limit?: number;
 *   metric?: { col: string; fn: AggFn };  // when present, order by metric desc
 * }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  let body: {
    column: string;
    filter?: FilterShape;
    query?: string;
    limit?: number;
    metric?: { col: string; fn: AggFn };
    /** Additional metrics returned alongside each value (e.g. sales to compute ROAS). */
    extraMetrics?: { col: string; fn: AggFn }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { column } = body;
  const limit = Math.min(body.limit ?? 500, 2000);
  const search = (body.query ?? "").trim();
  const metric = body.metric;
  if (metric && !AGG_FNS.has(metric.fn)) {
    return NextResponse.json({ error: `bad metric fn: ${metric.fn}` }, { status: 400 });
  }
  const extraMetrics = body.extraMetrics ?? [];
  for (const m of extraMetrics) {
    if (!AGG_FNS.has(m.fn)) {
      return NextResponse.json({ error: `bad extra metric fn: ${m.fn}` }, { status: 400 });
    }
  }

  if (!column) return NextResponse.json({ error: "column required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: type, error: typeErr } = await supabase
    .from("report_types")
    .select("id, table_name")
    .eq("slug", slug)
    .single();
  if (typeErr || !type) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { data: columns } = await supabase
    .from("report_columns")
    .select("column_name")
    .eq("report_type_id", type.id);
  const allowed = new Set((columns ?? []).map((c) => c.column_name));
  if (!allowed.has(column)) {
    return NextResponse.json({ error: `unknown column: ${column}` }, { status: 400 });
  }

  try {
    assertIdent(type.table_name, "table name");
    assertIdent(column, "column");
    if (metric) {
      if (!allowed.has(metric.col)) {
        return NextResponse.json({ error: `unknown metric column: ${metric.col}` }, { status: 400 });
      }
      assertIdent(metric.col, "metric column");
    }
    for (const em of extraMetrics) {
      if (!allowed.has(em.col)) {
        return NextResponse.json({ error: `unknown extra metric column: ${em.col}` }, { status: 400 });
      }
      assertIdent(em.col, "extra metric column");
    }

    // When searching, filter *this* column's own filter out of the WHERE
    // so the dropdown still shows all matches for the term even if others are selected.
    const filterForWhere: FilterShape = body.filter
      ? {
          dateColumn: body.filter.dateColumn,
          dateFrom: body.filter.dateFrom,
          dateTo: body.filter.dateTo,
          dimensions: Object.fromEntries(
            Object.entries(body.filter.dimensions ?? {}).filter(([c]) => c !== column),
          ),
        }
      : {};
    const where = buildWhereClause(filterForWhere, allowed);

    const searchClause = search
      ? `${where ? "and" : "where"} ${q(column)}::text ilike ${sqlLit("%" + search + "%")}`
      : "";
    const notNullClause = where || searchClause ? "and" : "where";

    const metricSelect = metric
      ? `, ${metric.fn}(${q(metric.col)})::float8 as metric`
      : "";
    const extraSelects = extraMetrics
      .map((em, i) => `, ${em.fn}(${q(em.col)})::float8 as e${i}`)
      .join("");
    const orderBy = metric ? "order by metric desc nulls last" : "order by count desc";

    const sql =
      `select ${q(column)}::text as value, count(*)::int as count${metricSelect}${extraSelects} ` +
      `from public.${q(type.table_name)} ` +
      `${where} ${searchClause} ${notNullClause} ${q(column)} is not null ` +
      `group by ${q(column)} ` +
      `${orderBy} ` +
      `limit ${limit}`;

    const rows = await execQueryLong<Record<string, unknown>>(sql);
    return NextResponse.json({
      values: rows,
      metric: metric ? { col: metric.col, fn: metric.fn } : null,
      extraMetrics: extraMetrics.map((em, i) => ({ col: em.col, fn: em.fn, alias: `e${i}` })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "distinct failed" },
      { status: 500 },
    );
  }
}
