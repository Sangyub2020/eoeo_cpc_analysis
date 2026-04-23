import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execDDL } from "@/lib/db/exec";
import { assertIdent, q } from "@/lib/reports/sql";

export const runtime = "nodejs";
// Index creation on a 12M-row table can take a couple of minutes. The client
// doesn't wait for this — we start the work in the background after responding.
export const maxDuration = 300;

interface FinalizePayload {
  upload_id: string;
  row_count: number;
}

export async function POST(req: Request) {
  let payload: FinalizePayload;
  try {
    payload = (await req.json()) as FinalizePayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { upload_id, row_count } = payload;
  if (!upload_id) return NextResponse.json({ error: "upload_id required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("report_uploads")
    .update({ row_count })
    .eq("id", upload_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Kick off index creation + ANALYZE for this table so dashboards aren't slow.
  // We don't await — the client already got its success.
  void ensureIndexes(upload_id).catch((e) => {
    console.error("[finalize] ensureIndexes failed:", e);
  });

  return NextResponse.json({ ok: true });
}

/**
 * Create btree indexes on the columns that the dashboard actually filters and
 * groups on (date/timestamp columns, text columns, upload_id), then run ANALYZE
 * so the planner + `pg_class.reltuples` reflect the new data.
 *
 * Each index is CREATE INDEX IF NOT EXISTS so re-running is a no-op. Indexes
 * are built via exec_ddl so the authenticator's 8 s statement_timeout doesn't
 * kill them mid-build.
 */
async function ensureIndexes(uploadId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Resolve which table this upload wrote to, plus the column types.
  const { data: upload, error: upErr } = await supabase
    .from("report_uploads")
    .select("report_type_id")
    .eq("id", uploadId)
    .single();
  if (upErr || !upload) return;

  const { data: reportType, error: rtErr } = await supabase
    .from("report_types")
    .select("table_name")
    .eq("id", upload.report_type_id)
    .single();
  if (rtErr || !reportType) return;
  const tableName = reportType.table_name as string;
  try {
    assertIdent(tableName, "table_name");
  } catch {
    return;
  }

  const { data: cols } = await supabase
    .from("report_columns")
    .select("column_name, data_type, is_key")
    .eq("report_type_id", upload.report_type_id);
  if (!cols?.length) return;

  const toIndex: string[] = ["upload_id"];
  for (const c of cols) {
    const name = c.column_name as string;
    try {
      assertIdent(name, "column_name");
    } catch {
      continue;
    }
    // Date/timestamp columns: always (used in every date filter).
    if (c.data_type === "date" || c.data_type === "timestamp") {
      toIndex.push(name);
      continue;
    }
    // Text columns commonly used as filter dimensions. Only index the "main"
    // ones — indexing every text column would balloon storage & slow writes.
    if (
      c.data_type === "text" &&
      (c.is_key ||
        name === "campaign_name" ||
        name === "search_term" ||
        name === "target_value" ||
        name === "ad_group_name")
    ) {
      toIndex.push(name);
    }
  }

  for (const col of toIndex) {
    const idxName = `idx_${tableName}_${col}`.slice(0, 63);
    try {
      await execDDL(
        `CREATE INDEX IF NOT EXISTS ${q(idxName)} ON public.${q(tableName)} (${q(col)})`,
      );
    } catch (e) {
      console.error(`[finalize] index ${idxName} failed:`, e);
    }
  }

  try {
    await execDDL(`ANALYZE public.${q(tableName)}`);
  } catch (e) {
    console.error(`[finalize] ANALYZE ${tableName} failed:`, e);
  }
}
