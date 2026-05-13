import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { execQueryLong } from "@/lib/db/exec";
import { assertIdent, q, sqlLit } from "@/lib/reports/sql";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Payload {
  campaign_names?: unknown;
}

/**
 * Look up which brand each campaign_name was previously assigned to by
 * scanning existing brand-scoped report tables (`rpt_<kind>__<brand_slug>`).
 * Used by the upload page to pre-fill brand assignments from prior uploads
 * when the campaign name exactly matches.
 *
 * Returns the brand with the most rows for each campaign — robust to rare
 * past mis-assignments that the user later corrected by re-uploading.
 */
export async function POST(req: Request) {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const namesRaw = Array.isArray(body.campaign_names) ? body.campaign_names : [];
  const names = Array.from(
    new Set(
      namesRaw.filter(
        (n): n is string => typeof n === "string" && n.length > 0,
      ),
    ),
  );
  if (names.length === 0) {
    return NextResponse.json({ mappings: {} });
  }

  const sb = getSupabaseAdmin();

  const [{ data: types, error: tErr }, { data: brands, error: bErr }] =
    await Promise.all([
      sb.from("report_types").select("slug, table_name"),
      sb.from("brands").select("slug"),
    ]);
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const validSlugs = new Set((brands ?? []).map((b) => b.slug as string));

  const namesInList = names.map((n) => sqlLit(n)).join(", ");
  const parts: string[] = [];
  for (const t of types ?? []) {
    const slug = String(t.slug);
    const tableName = String(t.table_name);
    const sep = slug.lastIndexOf("__");
    if (sep < 0) continue;
    const brandSlug = slug.slice(sep + 2);
    if (!validSlugs.has(brandSlug)) continue;
    try {
      assertIdent(tableName, "table_name");
    } catch {
      continue;
    }
    parts.push(
      `select campaign_name, ${sqlLit(brandSlug)}::text as brand_slug, count(*)::bigint as cnt ` +
        `from public.${q(tableName)} ` +
        `where campaign_name in (${namesInList}) ` +
        `group by campaign_name`,
    );
  }

  if (parts.length === 0) {
    return NextResponse.json({ mappings: {} });
  }

  const sql = `select campaign_name, brand_slug, sum(cnt)::bigint as cnt from (${parts.join(" union all ")}) u group by campaign_name, brand_slug`;

  let rows: { campaign_name: string; brand_slug: string; cnt: string | number }[];
  try {
    rows = await execQueryLong(sql);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "lookup failed" },
      { status: 500 },
    );
  }

  const best = new Map<string, { brand_slug: string; cnt: number }>();
  for (const r of rows) {
    const cnt = typeof r.cnt === "string" ? Number(r.cnt) : Number(r.cnt);
    if (!Number.isFinite(cnt)) continue;
    const cur = best.get(r.campaign_name);
    if (!cur || cnt > cur.cnt) {
      best.set(r.campaign_name, { brand_slug: r.brand_slug, cnt });
    }
  }

  const mappings: Record<string, string> = {};
  for (const [name, v] of best) mappings[name] = v.brand_slug;

  return NextResponse.json({ mappings });
}
