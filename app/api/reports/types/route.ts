import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildReportSummary, type SummaryColumn } from "@/lib/reports/summary";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();

  const { data: types, error } = await supabase
    .from("report_types")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!types || types.length === 0) {
    return NextResponse.json({ types: [] });
  }

  const typeIds = types.map((t) => t.id);
  const [{ data: allColumns }, { data: latestUploads }] = await Promise.all([
    supabase
      .from("report_columns")
      .select("report_type_id, column_name, source_header, data_type, is_key, position")
      .in("report_type_id", typeIds)
      .order("position", { ascending: true }),
    supabase
      .from("report_uploads")
      .select("report_type_id, uploaded_at")
      .in("report_type_id", typeIds)
      .order("uploaded_at", { ascending: false }),
  ]);

  const columnsByType = new Map<string, SummaryColumn[]>();
  for (const c of allColumns ?? []) {
    const arr = columnsByType.get(c.report_type_id) ?? [];
    arr.push({
      column_name: c.column_name,
      source_header: c.source_header,
      data_type: c.data_type,
      is_key: c.is_key,
      position: c.position,
    });
    columnsByType.set(c.report_type_id, arr);
  }

  const lastUploadByType = new Map<string, string>();
  for (const u of latestUploads ?? []) {
    if (!lastUploadByType.has(u.report_type_id)) {
      lastUploadByType.set(u.report_type_id, u.uploaded_at);
    }
  }

  const summaries = await Promise.all(
    types.map((t) =>
      buildReportSummary(
        t.table_name,
        columnsByType.get(t.id) ?? [],
        lastUploadByType.get(t.id) ?? null,
      ).catch(() => null),
    ),
  );

  const enriched = types.map((t, i) => ({
    ...t,
    summary: summaries[i],
  }));

  return NextResponse.json({ types: enriched });
}
