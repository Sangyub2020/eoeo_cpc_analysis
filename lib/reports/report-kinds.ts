import type { DataType, HeaderPlan } from "./types";

/**
 * Hardcoded schemas for the two Amazon report exports we support.
 *
 * Amazon always emits the same column set per report type (names drift slightly
 * across export variants — e.g. "Clicks" vs "Gross clicks"), so we don't ask
 * the user to confirm anything column-wise: pick the kind → we auto-build the
 * HeaderPlan by matching source_headers against the incoming file.
 */

export interface KindColumn {
  column_name: string;
  data_type: DataType;
  is_key: boolean;
  /** Candidate source headers — first one is the canonical label. Matched
   *  case-insensitively against the CSV headers. */
  source_headers: string[];
}

export interface KindSchema {
  slug: string;
  display_name: string;
  description: string;
  columns: KindColumn[];
}

export const KIND_SEARCH_TERM: KindSchema = {
  slug: "sp_search_term",
  display_name: "SP 검색어 레포트",
  description: "(date × campaign × search_term) 기반",
  columns: [
    { column_name: "date", data_type: "timestamp", is_key: true, source_headers: ["Date"] },
    { column_name: "campaign_name", data_type: "text", is_key: true, source_headers: ["Campaign name"] },
    { column_name: "campaign_id", data_type: "integer", is_key: false, source_headers: ["Campaign ID"] },
    {
      column_name: "search_term",
      data_type: "text",
      is_key: true,
      source_headers: ["Customer search term", "Search term", "Matched target"],
    },
    { column_name: "budget_currency", data_type: "text", is_key: false, source_headers: ["Budget currency"] },
    { column_name: "impressions", data_type: "integer", is_key: false, source_headers: ["Impressions", "Gross impressions"] },
    { column_name: "clicks", data_type: "integer", is_key: false, source_headers: ["Clicks", "Gross clicks"] },
    { column_name: "total_cost", data_type: "numeric", is_key: false, source_headers: ["Total cost", "Cost", "Spend"] },
    { column_name: "sales", data_type: "numeric", is_key: false, source_headers: ["Sales", "7 day total sales"] },
  ],
};

export const KIND_TARGET_KEYWORD: KindSchema = {
  slug: "sp_target_keyword",
  display_name: "SP 타겟 키워드 레포트",
  description: "(date × campaign × target × search term) 기반",
  columns: [
    { column_name: "date", data_type: "timestamp", is_key: true, source_headers: ["Date"] },
    { column_name: "campaign_name", data_type: "text", is_key: true, source_headers: ["Campaign name"] },
    { column_name: "campaign_id", data_type: "integer", is_key: false, source_headers: ["Campaign ID"] },
    { column_name: "target_value", data_type: "text", is_key: true, source_headers: ["Target value", "Target"] },
    { column_name: "target_match_type", data_type: "text", is_key: true, source_headers: ["Target match type"] },
    // In Target keyword reports, "Matched target" is the actual matched entity
    // (typically an ASIN) — we store it in `search_term` so the same dashboards
    // can show per-matched-entity breakdowns across both report kinds.
    { column_name: "search_term", data_type: "text", is_key: true, source_headers: ["Search term", "Matched target", "Customer search term"] },
    { column_name: "budget_currency", data_type: "text", is_key: false, source_headers: ["Budget currency"] },
    { column_name: "impressions", data_type: "integer", is_key: false, source_headers: ["Impressions", "Gross impressions"] },
    { column_name: "clicks", data_type: "integer", is_key: false, source_headers: ["Clicks", "Gross clicks"] },
    { column_name: "total_cost", data_type: "numeric", is_key: false, source_headers: ["Total cost", "Cost", "Spend"] },
    { column_name: "sales", data_type: "numeric", is_key: false, source_headers: ["Sales", "7 day total sales"] },
  ],
};

export const ALL_KINDS: KindSchema[] = [KIND_SEARCH_TERM, KIND_TARGET_KEYWORD];

/**
 * Match a schema's expected columns to the headers present in the uploaded
 * file (case-insensitive). Returns the resulting HeaderPlan plus a list of
 * missing columns (non-empty → caller should show an error).
 */
export function buildPlanForKind(
  schema: KindSchema,
  fileHeaders: string[],
): { plan: HeaderPlan[]; missing: KindColumn[] } {
  const headerByLower = new Map<string, string>();
  for (const h of fileHeaders) headerByLower.set(h.toLowerCase(), h);

  const plan: HeaderPlan[] = [];
  const missing: KindColumn[] = [];
  for (const col of schema.columns) {
    let resolved: string | undefined;
    for (const candidate of col.source_headers) {
      const hit = headerByLower.get(candidate.toLowerCase());
      if (hit) {
        resolved = hit;
        break;
      }
    }
    if (!resolved) {
      missing.push(col);
      continue;
    }
    plan.push({
      // Real file header → used for row reading on the client.
      source_header: resolved,
      // Canonical label → persisted in report_columns.source_header and
      // used by charts/UI. Independent of which export variant the user
      // uploaded, so display stays consistent.
      display_header: col.source_headers[0],
      column_name: col.column_name,
      data_type: col.data_type,
      is_key: col.is_key,
      is_new: true, // server will no-op is_new when column already exists
      include: true,
    });
  }
  return { plan, missing };
}
