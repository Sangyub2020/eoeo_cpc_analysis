import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQuery, execSQL } from "@/lib/db/exec";
import {
  buildAddColumnSQL,
  buildCreateTableSQL,
  assertIdent,
  q,
} from "@/lib/reports/sql";
import type { DataType, HeaderPlan } from "@/lib/reports/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface BeginPayload {
  slug: string;
  display_name: string;
  isNewType: boolean;
  headerPlan: HeaderPlan[];
  fileName: string;
  expectedRowCount: number;
  /** Optional brand/group tag. For new types written to report_types.brand;
   *  for existing types, if provided it overwrites the stored value. */
  brand?: string | null;
  /** Logical shape slug (e.g. 'sp_search_term'). Persisted on new types and
   *  overwritten on existing types when supplied — used by the brand-routing
   *  flow to group brand-scoped types by a shared shape. */
  kind?: string | null;
}

const SLUG_RE = /^[a-z][a-z0-9_]{0,62}$/;

export async function POST(req: Request) {
  let payload: BeginPayload;
  try {
    payload = (await req.json()) as BeginPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { slug, display_name, headerPlan, fileName, expectedRowCount } = payload;
  const brand = payload.brand?.trim() ? payload.brand.trim() : null;
  const kind = payload.kind?.trim() ? payload.kind.trim() : null;

  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: `invalid slug: must match ${SLUG_RE}` }, { status: 400 });
  }
  if (!display_name?.trim()) {
    return NextResponse.json({ error: "display_name required" }, { status: 400 });
  }
  if (!Array.isArray(headerPlan) || headerPlan.length === 0) {
    return NextResponse.json({ error: "headerPlan required" }, { status: 400 });
  }

  const activePlan = headerPlan.filter((h) => h.include);
  if (activePlan.length === 0) {
    return NextResponse.json({ error: "no columns selected" }, { status: 400 });
  }

  try {
    activePlan.forEach((h) => assertIdent(h.column_name, "column"));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid column name" },
      { status: 400 },
    );
  }

  const keyColumns = activePlan.filter((h) => h.is_key).map((h) => h.column_name);
  const tableName = `rpt_${slug}`;
  assertIdent(tableName, "table name");

  const supabase = getSupabaseAdmin();

  // Auto-detect create-vs-update by querying for the slug — don't trust the
  // client's `isNewType` flag. The upload page caches the type list at mount
  // and a fresh tab clicking 이어서 업로드 right after a previous upload can
  // race the cache, sending isNewType=true for a slug that now exists. Make
  // begin idempotent so it just does the right thing either way.
  const { data: existingType } = await supabase
    .from("report_types")
    .select("id, table_name")
    .eq("slug", slug)
    .maybeSingle();
  const goingToCreate = !existingType;

  let reportTypeId: string;
  if (goingToCreate) {
    try {
      await execSQL(
        buildCreateTableSQL(
          tableName,
          activePlan.map((h) => ({ name: h.column_name, type: h.data_type as DataType })),
          keyColumns,
        ),
      );
    } catch (e) {
      return NextResponse.json(
        { error: `create table failed: ${e instanceof Error ? e.message : e}` },
        { status: 500 },
      );
    }

    const { data: inserted, error: typeErr } = await supabase
      .from("report_types")
      .insert({
        slug,
        display_name,
        table_name: tableName,
        key_columns: keyColumns,
        brand,
        kind,
      })
      .select()
      .single();
    if (typeErr || !inserted) {
      return NextResponse.json(
        { error: typeErr?.message ?? "create type failed" },
        { status: 500 },
      );
    }
    reportTypeId = inserted.id;

    const { error: colErr } = await supabase.from("report_columns").insert(
      activePlan.map((h, idx) => ({
        report_type_id: reportTypeId,
        column_name: h.column_name,
        // Prefer the canonical display label if the client provided one,
        // so target-keyword uploads show "Search term" not "Matched target".
        source_header: h.display_header ?? h.source_header,
        data_type: h.data_type,
        is_key: h.is_key,
        position: idx,
      })),
    );
    if (colErr) return NextResponse.json({ error: colErr.message }, { status: 500 });
  } else {
    if (existingType.table_name !== tableName) {
      return NextResponse.json({ error: "slug mismatch with stored table_name" }, { status: 409 });
    }
    reportTypeId = existingType.id;

    // If the caller supplied a brand on an existing type, overwrite — makes
    // it easy to retroactively group a report that was created before the
    // brand field existed. Same pattern for kind.
    const patch: Record<string, unknown> = {};
    if (brand !== null) patch.brand = brand;
    if (kind !== null) patch.kind = kind;
    if (Object.keys(patch).length > 0) {
      await supabase.from("report_types").update(patch).eq("id", reportTypeId);
    }

    // Don't trust the client's `is_new` flag — it can be stale (e.g. when the
    // upload page's existingTypes cache loaded before another tab created the
    // type, or before pickKindSchema's existingColumns fetch resolved). Look
    // up the actual column set from the DB and ALTER TABLE only for genuinely
    // missing columns. Avoids running needless ADD COLUMN against a
    // multi-million-row sp_raw table, which acquires locks and times out.
    const { data: actualCols } = await supabase
      .from("report_columns")
      .select("column_name")
      .eq("report_type_id", reportTypeId);
    const existingColSet = new Set(
      (actualCols ?? []).map((c) => c.column_name),
    );
    const newCols = activePlan.filter(
      (h) => !existingColSet.has(h.column_name),
    );
    for (const c of newCols) {
      try {
        await execSQL(buildAddColumnSQL(tableName, c.column_name, c.data_type as DataType));
      } catch (e) {
        return NextResponse.json(
          { error: `add column failed (${c.column_name}): ${e instanceof Error ? e.message : e}` },
          { status: 500 },
        );
      }
    }
    if (newCols.length) {
      const { error: cErr } = await supabase
        .from("report_columns")
        .upsert(
          newCols.map((h, idx) => ({
            report_type_id: reportTypeId,
            column_name: h.column_name,
            source_header: h.display_header ?? h.source_header,
            data_type: h.data_type,
            is_key: false,
            position: 999 + idx,
          })),
          { onConflict: "report_type_id,column_name", ignoreDuplicates: true },
        );
      if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    }
  }

  const { data: upload, error: upErr } = await supabase
    .from("report_uploads")
    .insert({
      report_type_id: reportTypeId,
      file_name: fileName || "upload",
      row_count: 0, // updated by finalize
    })
    .select()
    .single();
  if (upErr || !upload) {
    return NextResponse.json({ error: upErr?.message ?? "upload record failed" }, { status: 500 });
  }

  // Probe the latest date already in the destination table so the client can
  // (optionally) skip rows it already has — used by the "이어서 업로드"
  // continuation flow on the brand page. Cheap query (min/max with no scan).
  let latestDate: string | null = null;
  if (!goingToCreate) {
    try {
      const dateColEntry = activePlan.find(
        (h) => h.data_type === "date" || h.data_type === "timestamp",
      );
      if (dateColEntry) {
        const rows = await execQuery<{ d: string | null }>(
          `select max(${q(dateColEntry.column_name)})::text as d from public.${q(tableName)}`,
        );
        latestDate = rows[0]?.d ? rows[0].d.slice(0, 10) : null;
      }
    } catch {
      // non-critical — fall through with null
    }
  }

  return NextResponse.json({
    upload_id: upload.id,
    report_type_id: reportTypeId,
    slug,
    tableName,
    columnNames: activePlan.map((h) => h.column_name),
    sourceHeaders: activePlan.map((h) => h.source_header),
    dataTypes: activePlan.map((h) => h.data_type),
    keyColumns,
    expectedRowCount,
    latestDate,
  });
}
