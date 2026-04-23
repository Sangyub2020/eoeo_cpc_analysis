import { execQuery } from "@/lib/db/exec";
import { assertIdent, q, sqlLit } from "@/lib/reports/sql";
import type { DataType } from "@/lib/reports/types";

/** Tables larger than this use a fast `pg_class.reltuples` estimate instead of
 *  exact count(*) + sum/min/max aggregates, which would full-scan and time out. */
const FAST_PATH_ROW_THRESHOLD = 1_000_000;

export interface SummaryColumn {
  column_name: string;
  source_header: string;
  data_type: DataType;
  is_key: boolean;
  position: number;
}

export interface TopValue {
  value: string | null;
  count: number;
}

export interface ReportSummary {
  rowCount: number;
  dateRange: {
    column: string;
    source_header: string;
    min: string | null;
    max: string | null;
    days: number | null;
  } | null;
  metrics: {
    column: string;
    source_header: string;
    sum: number | null;
    data_type: DataType;
  }[];
  dimension: {
    column: string;
    source_header: string;
    top: TopValue[];
    distinctCount: number;
  } | null;
  lastUploadedAt: string | null;
}

/**
 * Build a compact summary for a single report type.
 * Returns null on failure (table missing, query error).
 */
export async function buildReportSummary(
  tableName: string,
  columns: SummaryColumn[],
  lastUploadedAt: string | null,
): Promise<ReportSummary | null> {
  try {
    assertIdent(tableName, "table name");
  } catch {
    return null;
  }

  const dateCol = columns.find(
    (c) => c.data_type === "date" || c.data_type === "timestamp",
  );
  const numericCols = columns
    .filter((c) => c.data_type === "numeric" || c.data_type === "integer")
    .slice(0, 4);
  const dimCol =
    columns.find((c) => c.data_type === "text" && c.is_key) ||
    columns.find((c) => c.data_type === "text");

  // Use pg_class's fast row estimate to decide whether an exact aggregate is
  // feasible. For huge tables (>1M rows, no indexes), count/sum/min/max would
  // full-scan and time out — fall back to showing just the estimate.
  let estimateRowCount = 0;
  try {
    const est = await execQuery<{ n: number | null }>(
      `select coalesce(reltuples,0)::bigint as n from pg_class ` +
        `where relname = ${sqlLit(tableName)} and relkind = 'r' limit 1`,
    );
    estimateRowCount = Number(est[0]?.n ?? 0);
  } catch {
    // fall through — we'll attempt the exact aggregate below
  }

  const fastPath = estimateRowCount >= FAST_PATH_ROW_THRESHOLD;
  type AggRow = Record<string, number | string | null>;
  let agg: AggRow = {};
  let rowCount = 0;

  if (fastPath) {
    rowCount = estimateRowCount;
  } else {
    // Single aggregate row — exact values for small/mid tables
    const parts: string[] = ["count(*) as row_count"];
    if (dateCol) {
      parts.push(`min(${q(dateCol.column_name)})::text as min_date`);
      parts.push(`max(${q(dateCol.column_name)})::text as max_date`);
    }
    for (const nc of numericCols) {
      parts.push(`sum(${q(nc.column_name)})::float8 as ${q(nc.column_name + "_sum")}`);
    }
    const aggSQL = `select ${parts.join(", ")} from public.${q(tableName)}`;
    try {
      const aggRows = await execQuery<AggRow>(aggSQL);
      agg = aggRows[0] ?? {};
      rowCount = Number(agg.row_count ?? 0);
    } catch {
      // Even the "small" path can time out (e.g. stale reltuples estimate).
      // Fall back to whatever estimate we have so the list page still renders.
      rowCount = estimateRowCount;
    }
  }

  let dimension: ReportSummary["dimension"] = null;
  if (dimCol && rowCount > 0 && !fastPath) {
    try {
      const topRows = await execQuery<{ v: string | null; n: number }>(
        `select ${q(dimCol.column_name)} as v, count(*)::int as n ` +
          `from public.${q(tableName)} ` +
          `where ${q(dimCol.column_name)} is not null ` +
          `group by ${q(dimCol.column_name)} order by n desc limit 5`,
      );
      const distRows = await execQuery<{ c: number }>(
        `select count(distinct ${q(dimCol.column_name)})::int as c from public.${q(tableName)}`,
      );
      dimension = {
        column: dimCol.column_name,
        source_header: dimCol.source_header,
        top: topRows.map((r) => ({ value: r.v, count: Number(r.n) })),
        distinctCount: Number(distRows[0]?.c ?? 0),
      };
    } catch {
      dimension = null;
    }
  }

  const minDate = (agg.min_date as string | null) ?? null;
  const maxDate = (agg.max_date as string | null) ?? null;
  let days: number | null = null;
  if (minDate && maxDate) {
    const a = new Date(minDate);
    const b = new Date(maxDate);
    if (!isNaN(a.getTime()) && !isNaN(b.getTime())) {
      days = Math.max(1, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    }
  }

  return {
    rowCount,
    dateRange: dateCol
      ? {
          column: dateCol.column_name,
          source_header: dateCol.source_header,
          min: minDate,
          max: maxDate,
          days,
        }
      : null,
    metrics: numericCols.map((nc) => ({
      column: nc.column_name,
      source_header: nc.source_header,
      sum: agg[nc.column_name + "_sum"] == null ? null : Number(agg[nc.column_name + "_sum"]),
      data_type: nc.data_type,
    })),
    dimension,
    lastUploadedAt,
  };
}
