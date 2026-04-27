import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQueryLong } from "@/lib/db/exec";
import { assertIdent, q, sqlLit } from "@/lib/reports/sql";

export const runtime = "nodejs";
export const maxDuration = 60;

interface UploadInfo {
  id: string;
  file_name: string;
  uploaded_at: string;
  row_count: number; // recorded count from upload time
  /** Actual rows in the table for this upload_id. Differs from `row_count`
   *  when later UPSERTs overwrote rows with the same key. */
  db_row_count: number;
  min_date: string | null;
  max_date: string | null;
}

interface TypeWithUploads {
  type_id: string;
  slug: string;
  display_name: string;
  table_name: string;
  kind: string | null;
  uploads: UploadInfo[];
}

/**
 * List every upload under a brand grouped by report_type, with each upload's
 * actual row count + min/max date pulled from the destination table. The
 * UI on the brand page uses this for the "업로드 관리" tab where users can
 * inspect and delete individual uploads.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = decodeURIComponent((await ctx.params).brand).trim();
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: types, error: tErr } = await supabase
    .from("report_types")
    .select("id, slug, display_name, table_name, kind")
    .eq("brand", brand)
    .order("created_at", { ascending: true });
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!types?.length) return NextResponse.json({ types: [] });

  const typeIds = types.map((t) => t.id);

  // Pull all upload rows for these types in one shot.
  const { data: uploads, error: uErr } = await supabase
    .from("report_uploads")
    .select("id, report_type_id, file_name, uploaded_at, row_count")
    .in("report_type_id", typeIds)
    .order("uploaded_at", { ascending: false });
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Need date column for each table — fetch from report_columns.
  const { data: cols } = await supabase
    .from("report_columns")
    .select("report_type_id, column_name, data_type")
    .in("report_type_id", typeIds);
  const dateColByType = new Map<string, string | null>();
  for (const t of types) {
    const dc = (cols ?? []).find(
      (c) =>
        c.report_type_id === t.id &&
        (c.data_type === "date" || c.data_type === "timestamp"),
    );
    dateColByType.set(t.id, dc?.column_name ?? null);
  }

  // For each type, run ONE GROUP-BY-upload_id query that returns stats for
  // every upload at once. Per-upload queries used to time out under load
  // (heavy parallel UPSERTs into sp_raw kept this endpoint waiting for
  // index locks). One scan per type is bounded and uses the upload_id index.
  const result: TypeWithUploads[] = await Promise.all(
    types.map(async (t) => {
      const uploadsForType = (uploads ?? []).filter(
        (u) => u.report_type_id === t.id,
      );
      try {
        assertIdent(t.table_name, "table");
      } catch {
        return {
          type_id: t.id,
          slug: t.slug,
          display_name: t.display_name,
          table_name: t.table_name,
          kind: t.kind,
          uploads: uploadsForType.map((u) => ({
            id: u.id,
            file_name: u.file_name ?? "",
            uploaded_at: u.uploaded_at,
            row_count: u.row_count ?? 0,
            db_row_count: 0,
            min_date: null,
            max_date: null,
          })),
        };
      }

      // Default: every upload reports zeros until the GROUP BY query fills
      // them in. Important — even if the stats query fails (timeout, etc.)
      // we still return the upload list so the UI never goes blank.
      const stats = new Map<
        string,
        { n: number; min_date: string | null; max_date: string | null }
      >();

      if (uploadsForType.length > 0) {
        const dateCol = dateColByType.get(t.id);
        const dateSelect =
          dateCol != null
            ? `, min(${q(dateCol)})::text as min_date, max(${q(dateCol)})::text as max_date`
            : ", null::text as min_date, null::text as max_date";
        const ids = uploadsForType
          .map((u) => `${sqlLit(u.id)}::uuid`)
          .join(", ");
        const sql = `select upload_id::text as upload_id, count(*)::int as n${dateSelect}
          from public.${q(t.table_name)}
          where upload_id in (${ids})
          group by upload_id`;
        try {
          const rows = await execQueryLong<{
            upload_id: string;
            n: number;
            min_date: string | null;
            max_date: string | null;
          }>(sql);
          for (const r of rows) {
            stats.set(r.upload_id, {
              n: Number(r.n ?? 0),
              min_date: r.min_date ? r.min_date.slice(0, 10) : null,
              max_date: r.max_date ? r.max_date.slice(0, 10) : null,
            });
          }
        } catch {
          // ignore — uploads list still returns with zero stats
        }
      }

      const enrichedUploads: UploadInfo[] = uploadsForType.map((u) => {
        const s = stats.get(u.id);
        return {
          id: u.id,
          file_name: u.file_name ?? "",
          uploaded_at: u.uploaded_at,
          row_count: u.row_count ?? 0,
          db_row_count: s?.n ?? 0,
          min_date: s?.min_date ?? null,
          max_date: s?.max_date ?? null,
        };
      });

      return {
        type_id: t.id,
        slug: t.slug,
        display_name: t.display_name,
        table_name: t.table_name,
        kind: t.kind,
        uploads: enrichedUploads,
      };
    }),
  );

  return NextResponse.json({ types: result });
}
