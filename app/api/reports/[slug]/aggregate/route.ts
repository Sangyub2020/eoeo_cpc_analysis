import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQueryLong } from "@/lib/db/exec";
import { assertIdent, buildWhereClause, q, type FilterShape } from "@/lib/reports/sql";

export const runtime = "nodejs";
export const maxDuration = 60;

type AggFn = "sum" | "avg" | "min" | "max" | "count";
const AGG_FNS: Set<AggFn> = new Set(["sum", "avg", "min", "max", "count"]);

interface AggregatePayload {
  filter: FilterShape;
  xColumn: string;
  groupColumn?: string | null;
  metrics: { col: string; fn: AggFn }[];
  limit?: number;
  /**
   * "day" = one row per calendar day (default).
   * "week" = 7-day buckets starting Jan 1 of each year. For `sum` and `count`
   * metrics, the per-bucket value is divided by the number of distinct days
   * actually present in that bucket, yielding a *daily average* within the week.
   */
  xBucket?: "day" | "week";
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  let payload: AggregatePayload;
  try {
    payload = (await req.json()) as AggregatePayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { filter, xColumn, groupColumn, metrics } = payload;
  const limit = Math.min(payload.limit ?? 5000, 20000);
  const xBucket: "day" | "week" = payload.xBucket === "week" ? "week" : "day";

  if (!xColumn) return NextResponse.json({ error: "xColumn required" }, { status: 400 });
  if (!Array.isArray(metrics) || metrics.length === 0) {
    return NextResponse.json({ error: "metrics required" }, { status: 400 });
  }
  for (const m of metrics) {
    if (!AGG_FNS.has(m.fn)) {
      return NextResponse.json({ error: `bad agg fn: ${m.fn}` }, { status: 400 });
    }
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

  const { data: columns, error: colErr } = await supabase
    .from("report_columns")
    .select("column_name, data_type")
    .eq("report_type_id", type.id);
  if (colErr) {
    return NextResponse.json({ error: colErr.message }, { status: 500 });
  }
  const typeByCol = new Map<string, string>(
    (columns ?? []).map((c) => [c.column_name, c.data_type]),
  );
  const allowed = new Set(typeByCol.keys());

  const dimExpr = (col: string): string => {
    assertIdent(col, "column");
    const dt = typeByCol.get(col);
    if (dt === "timestamp") return `${q(col)}::date`;
    return q(col);
  };

  /** Bucket a date/timestamp column into 7-day windows anchored at Jan 1. */
  const weekBucketExpr = (dateExpr: string) =>
    `(date_trunc('year', ${dateExpr})::date + ((extract(doy from ${dateExpr})::int - 1) / 7) * 7)::date`;

  try {
    assertIdent(type.table_name, "table name");
    if (!allowed.has(xColumn)) {
      return NextResponse.json({ error: `unknown column: ${xColumn}` }, { status: 400 });
    }
    if (groupColumn && !allowed.has(groupColumn)) {
      return NextResponse.json({ error: `unknown column: ${groupColumn}` }, { status: 400 });
    }
    for (const m of metrics) {
      if (!allowed.has(m.col)) {
        return NextResponse.json({ error: `unknown column: ${m.col}` }, { status: 400 });
      }
    }

    const xDateExpr = dimExpr(xColumn);
    const xExpr = xBucket === "week" ? weekBucketExpr(xDateExpr) : xDateExpr;
    const gExpr = groupColumn ? dimExpr(groupColumn) : null;
    const where = buildWhereClause(filter ?? {}, allowed);
    const tableRef = `public.${q(type.table_name)}`;

    // In week mode, sum/count are divided by the number of distinct days present
    // in each bucket (and each group, if grouped) — giving a *daily average*.
    const metricSelects = metrics
      .map((m, i) => {
        if (xBucket === "week" && (m.fn === "sum" || m.fn === "count")) {
          return `(${m.fn}(${q(m.col)})::float8 / greatest(count(distinct ${xDateExpr})::float8, 1)) as m${i}`;
        }
        return `${m.fn}(${q(m.col)})::float8 as m${i}`;
      })
      .join(", ");

    const selects: string[] = [`${xExpr}::text as x`];
    if (gExpr) selects.push(`${gExpr}::text as g`);
    selects.push(metricSelects);

    const groupBy = [xExpr];
    if (gExpr) groupBy.push(gExpr);

    const rowsSql =
      `select ${selects.join(", ")} ` +
      `from ${tableRef} ` +
      (where ? `${where} ` : "") +
      `group by ${groupBy.join(", ")} ` +
      `order by ${xExpr} ` +
      `limit ${limit}`;

    // Separate totals query: true sum across the entire filtered dataset, independent
    // of bucketing. Used for the "합계" label in the chart UI.
    const totalsSelects = metrics
      .map((m, i) => `${m.fn}(${q(m.col)})::float8 as m${i}`)
      .join(", ");
    const totalsSql = `select ${totalsSelects} from ${tableRef} ${where}`;

    const [rows, totalsRows] = await Promise.all([
      execQueryLong<Record<string, unknown>>(rowsSql),
      execQueryLong<Record<string, unknown>>(totalsSql),
    ]);
    const totalsRow = totalsRows[0] ?? {};

    return NextResponse.json({
      xColumn,
      xDataType: typeByCol.get(xColumn) ?? "text",
      xBucket,
      groupColumn: groupColumn || null,
      metricColumns: metrics.map((m, i) => ({ col: m.col, fn: m.fn, alias: `m${i}` })),
      totals: metrics.map((m, i) => ({
        col: m.col,
        fn: m.fn,
        total:
          totalsRow[`m${i}`] == null || !Number.isFinite(Number(totalsRow[`m${i}`]))
            ? null
            : Number(totalsRow[`m${i}`]),
      })),
      rows,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "aggregate failed" },
      { status: 500 },
    );
  }
}
