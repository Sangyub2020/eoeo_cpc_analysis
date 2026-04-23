import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQuery, execQueryLong } from "@/lib/db/exec";
import { assertIdent, buildWhereClause, q, sqlLit, type FilterShape } from "@/lib/reports/sql";

/** count(*) above this threshold is considered too slow even with indexes; use pg_class estimate instead. */
const EXACT_COUNT_MAX_ROWS = 500_000;

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Server-paginated, filter-aware rows endpoint for the table view.
 * Body: { filter: FilterShape; select?: string[]; orderBy?: { column, dir }; limit?: number; offset?: number }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  let body: {
    filter?: FilterShape;
    select?: string[];
    orderBy?: { column: string; dir: "asc" | "desc" };
    limit?: number;
    offset?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const limit = Math.min(body.limit ?? 100, 2000);
  const offset = Math.max(0, body.offset ?? 0);

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
    .select("column_name, position")
    .eq("report_type_id", type.id)
    .order("position", { ascending: true });
  const allowed = new Set((columns ?? []).map((c) => c.column_name));

  try {
    assertIdent(type.table_name, "table name");

    const cols = (body.select && body.select.length
      ? body.select.filter((c) => allowed.has(c))
      : (columns ?? []).map((c) => c.column_name));
    cols.forEach((c) => assertIdent(c, "select column"));
    const selectList = cols.length ? cols.map(q).join(", ") : "*";

    const where = buildWhereClause(body.filter ?? {}, allowed);

    let orderBy = "";
    if (body.orderBy && allowed.has(body.orderBy.column)) {
      assertIdent(body.orderBy.column, "orderBy column");
      const dir = body.orderBy.dir === "desc" ? "desc nulls last" : "asc nulls last";
      orderBy = `order by ${q(body.orderBy.column)} ${dir}`;
    }

    const dataSQL =
      `select ${selectList} from public.${q(type.table_name)} ` +
      (where ? `${where} ` : "") +
      (orderBy ? `${orderBy} ` : "") +
      `limit ${limit} offset ${offset}`;

    // For unfiltered count, use pg_class.reltuples (instant, approximate).
    // For filtered count on a small table, run exact count(*); for big tables
    // with a filter, skip the count (return null) so the UI doesn't time out —
    // DataTable already handles `total: null` by hiding the counter.
    const estimateRows = await execQuery<{ n: number | null }>(
      `select coalesce(reltuples,0)::bigint as n from pg_class ` +
        `where relname = ${sqlLit(type.table_name)} and relkind = 'r' limit 1`,
    )
      .then((r) => Number(r[0]?.n ?? 0))
      .catch(() => 0);

    const rows = await execQueryLong<Record<string, unknown>>(dataSQL);

    let total: number | null;
    if (!where) {
      total = estimateRows;
    } else if (estimateRows > 0 && estimateRows <= EXACT_COUNT_MAX_ROWS) {
      try {
        const countRows = await execQuery<{ c: number }>(
          `select count(*)::int as c from public.${q(type.table_name)} ${where}`,
        );
        total = countRows[0]?.c ?? 0;
      } catch {
        total = null;
      }
    } else {
      // Too many rows to safely count under the 8 s authenticator timeout even with indexes.
      // Return null so the UI can show "—" instead of a wrong 0.
      total = null;
    }

    return NextResponse.json({
      rows,
      total,
      limit,
      offset,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "rows query failed" },
      { status: 500 },
    );
  }
}
