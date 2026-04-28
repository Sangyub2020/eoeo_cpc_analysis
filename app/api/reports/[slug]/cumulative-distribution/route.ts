import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQueryLong } from "@/lib/db/exec";
import { assertIdent, buildWhereClause, q, type FilterShape } from "@/lib/reports/sql";

export const runtime = "nodejs";

type AggFn = "sum" | "avg" | "min" | "max" | "count";
const AGG_FNS: Set<AggFn> = new Set(["sum", "avg", "min", "max", "count"]);

/**
 * Cumulative distribution of a metric across distinct values of a stack column.
 *
 * mode: "sampled" (default) — returns ~600 sampled (rank, cumulative_metric)
 *   points so the long-tail Lorenz-style curve can be drawn even when the
 *   universe is 50k+ distinct values. Sampling: every rank up to 200, every
 *   10th up to 2000, every 100th up to 20000, then every 1000th, plus the
 *   final point.
 *
 * mode: "full" — returns the entire ranked list (rank, value, sales) sorted
 *   desc. Hard-capped at 500k rows. No cumulative column (client computes
 *   share = sales / totalSales). Used to power a virtualized full-keyword
 *   panel.
 *
 * Body: { column, metric: {col, fn}, filter?, mode? }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  let body: {
    column: string;
    metric: { col: string; fn: AggFn };
    filter?: FilterShape;
    mode?: "sampled" | "full";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { column, metric } = body;
  if (!column) return NextResponse.json({ error: "column required" }, { status: 400 });
  if (!metric || !AGG_FNS.has(metric.fn)) {
    return NextResponse.json({ error: "metric required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: type, error: typeErr } = await supabase
    .from("report_types")
    .select("id, table_name")
    .eq("slug", slug)
    .single();
  if (typeErr || !type) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { data: cols } = await supabase
    .from("report_columns")
    .select("column_name")
    .eq("report_type_id", type.id);
  const allowed = new Set((cols ?? []).map((c) => c.column_name));
  if (!allowed.has(column)) {
    return NextResponse.json({ error: `unknown column: ${column}` }, { status: 400 });
  }
  if (!allowed.has(metric.col)) {
    return NextResponse.json({ error: `unknown metric column: ${metric.col}` }, { status: 400 });
  }

  try {
    assertIdent(type.table_name, "table name");
    assertIdent(column, "column");
    assertIdent(metric.col, "metric column");

    // Strip the stack column's own dimension filter so the distribution covers
    // every value in this filter context, not just the user-selected subset.
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

    const totalsCte =
      `with totals as (` +
      `  select ${q(column)}::text as v, ${metric.fn}(${q(metric.col)})::float8 as s ` +
      `  from public.${q(type.table_name)} ` +
      `  ${where} ` +
      `  group by ${q(column)} ` +
      `  having ${metric.fn}(${q(metric.col)}) > 0` +
      `), summary as (` +
      `  select count(*)::int as n, coalesce(sum(s), 0)::float8 as total_sales from totals` +
      `)`;

    const mode: "sampled" | "full" = body.mode === "full" ? "full" : "sampled";

    if (mode === "full") {
      const sql =
        totalsCte +
        ` select row_number() over (order by s desc nulls last)::int as rk, ` +
        `   v, s::float8 as s, ` +
        `   (select n from summary) as n, ` +
        `   (select total_sales from summary) as total_sales ` +
        ` from totals ` +
        ` order by s desc nulls last ` +
        ` limit 500000`;

      const rows = await execQueryLong<{
        rk: number;
        s: number;
        v: string;
        n: number;
        total_sales: number;
      }>(sql);
      const n = rows[0]?.n ?? 0;
      const totalSales = rows[0]?.total_sales ?? 0;
      return NextResponse.json({
        n,
        totalSales,
        rows: rows.map((r) => ({ rk: r.rk, v: r.v, s: r.s })),
      });
    }

    const sql =
      totalsCte +
      `, ranked as (` +
      `  select v, s, ` +
      `    row_number() over (order by s desc nulls last) as rk, ` +
      `    sum(s) over (order by s desc nulls last rows between unbounded preceding and current row) as cum_s ` +
      `  from totals` +
      `) ` +
      `select rk::int as rk, cum_s::float8 as cum_s, s::float8 as s, v, ` +
      `  (select n from summary) as n, ` +
      `  (select total_sales from summary) as total_sales ` +
      `from ranked ` +
      `where rk <= 200 ` +
      `   or (rk <= 2000 and rk % 10 = 0) ` +
      `   or (rk <= 20000 and rk % 100 = 0) ` +
      `   or rk % 1000 = 0 ` +
      `   or rk = (select n from summary) ` +
      `order by rk`;

    const rows = await execQueryLong<{
      rk: number;
      cum_s: number;
      s: number;
      v: string;
      n: number;
      total_sales: number;
    }>(sql);

    const n = rows[0]?.n ?? 0;
    const totalSales = rows[0]?.total_sales ?? 0;
    return NextResponse.json({
      n,
      totalSales,
      points: rows.map((r) => ({ rk: r.rk, cum: r.cum_s, s: r.s, v: r.v })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cumulative-distribution failed" },
      { status: 500 },
    );
  }
}
