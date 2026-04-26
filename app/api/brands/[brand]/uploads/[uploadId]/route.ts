import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execDDL } from "@/lib/db/exec";
import { assertIdent, q, sqlLit } from "@/lib/reports/sql";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Delete one upload — removes every row in the destination table whose
 * upload_id matches, then deletes the upload record itself. Brand-scoped:
 * the upload must belong to a report_type whose `brand` equals the URL
 * brand, otherwise we 404 (basic guard against cross-brand mishaps).
 *
 * Uses execDDL so the DELETE escapes the authenticator's 8s statement
 * timeout when removing hundreds of thousands of rows.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ brand: string; uploadId: string }> },
) {
  const { brand: rawBrand, uploadId } = await ctx.params;
  const brand = decodeURIComponent(rawBrand).trim();
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });
  if (!uploadId) return NextResponse.json({ error: "uploadId required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: upload, error: uErr } = await supabase
    .from("report_uploads")
    .select("id, report_type_id, report_types!inner(brand, table_name)")
    .eq("id", uploadId)
    .maybeSingle();
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (!upload) return NextResponse.json({ error: "upload not found" }, { status: 404 });

  // PostgREST returns the joined row as either a single object or an array
  // depending on cardinality. Normalize.
  const rt = Array.isArray(upload.report_types)
    ? upload.report_types[0]
    : upload.report_types;
  if (!rt || rt.brand !== brand) {
    return NextResponse.json({ error: "upload does not belong to this brand" }, { status: 404 });
  }
  const tableName = rt.table_name as string;
  try {
    assertIdent(tableName, "table");
  } catch {
    return NextResponse.json({ error: "invalid table name" }, { status: 500 });
  }

  // Wipe the data rows. Index on upload_id keeps this fast even on big tables.
  try {
    await execDDL(
      `DELETE FROM public.${q(tableName)} WHERE upload_id = ${sqlLit(uploadId)}`,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `delete rows failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }

  // Then drop the upload metadata.
  const { error: delErr } = await supabase
    .from("report_uploads")
    .delete()
    .eq("id", uploadId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
