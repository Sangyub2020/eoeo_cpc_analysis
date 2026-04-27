import type { DataType, HeaderPlan } from "./types";

/**
 * Hardcoded schemas for the three Amazon report exports we support. Pick a
 * kind on upload → we auto-build the HeaderPlan by matching `source_headers`
 * against the incoming CSV (case-insensitive). `category` groups columns
 * into Dimension vs Metric for the user-facing schema description.
 */

export interface KindColumn {
  column_name: string;
  data_type: DataType;
  is_key: boolean;
  /** "Dimension" → who/when/what is being measured (used to GROUP BY).
   *  "Metric"    → numbers being measured (Impressions, Clicks, Cost, …). */
  category: "dimension" | "metric";
  /** Friendly Korean label for the missing-column hint. */
  ko: string;
  /** Candidate source headers — first one is the canonical label that will
   *  be persisted in `report_columns.source_header` and shown in the UI.
   *  Matched case-insensitively against the CSV headers. */
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
  display_name: "Search Term Report",
  description: "검색어(Search term)별 성과",
  columns: [
    { column_name: "date", data_type: "timestamp", is_key: true, category: "dimension", ko: "날짜", source_headers: ["Date"] },
    { column_name: "campaign_name", data_type: "text", is_key: true, category: "dimension", ko: "캠페인 이름", source_headers: ["Campaign name"] },
    {
      column_name: "search_term",
      data_type: "text",
      is_key: true,
      category: "dimension",
      ko: "검색어",
      source_headers: ["Search term", "Customer search term", "Matched target"],
    },
    { column_name: "budget_currency", data_type: "text", is_key: false, category: "dimension", ko: "통화", source_headers: ["Budget currency"] },
    { column_name: "impressions", data_type: "integer", is_key: false, category: "metric", ko: "노출수", source_headers: ["Impressions", "Gross impressions"] },
    { column_name: "clicks", data_type: "integer", is_key: false, category: "metric", ko: "클릭수", source_headers: ["Clicks", "Gross clicks"] },
    { column_name: "total_cost", data_type: "numeric", is_key: false, category: "metric", ko: "비용", source_headers: ["Total cost", "Cost", "Spend"] },
    { column_name: "sales", data_type: "numeric", is_key: false, category: "metric", ko: "매출", source_headers: ["Sales", "7 day total sales"] },
  ],
};

export const KIND_TARGET_KEYWORD: KindSchema = {
  slug: "sp_target_keyword",
  display_name: "Target Keyword Report",
  description: "타겟 키워드별 성과 (Target Value × Match Type)",
  columns: [
    { column_name: "date", data_type: "timestamp", is_key: true, category: "dimension", ko: "날짜", source_headers: ["Date"] },
    { column_name: "campaign_name", data_type: "text", is_key: true, category: "dimension", ko: "캠페인 이름", source_headers: ["Campaign name"] },
    { column_name: "target_value", data_type: "text", is_key: true, category: "dimension", ko: "타겟 값", source_headers: ["Target value"] },
    { column_name: "target_match_type", data_type: "text", is_key: true, category: "dimension", ko: "매치 타입", source_headers: ["Target match type"] },
    { column_name: "budget_currency", data_type: "text", is_key: false, category: "dimension", ko: "통화", source_headers: ["Budget currency"] },
    { column_name: "impressions", data_type: "integer", is_key: false, category: "metric", ko: "노출수", source_headers: ["Impressions", "Gross impressions"] },
    { column_name: "clicks", data_type: "integer", is_key: false, category: "metric", ko: "클릭수", source_headers: ["Clicks", "Gross clicks"] },
    { column_name: "total_cost", data_type: "numeric", is_key: false, category: "metric", ko: "비용", source_headers: ["Total cost", "Cost", "Spend"] },
    { column_name: "sales", data_type: "numeric", is_key: false, category: "metric", ko: "매출", source_headers: ["Sales", "7 day total sales"] },
  ],
};

/**
 * Raw 3-way table — (date × campaign × target × search term). Used ONLY for
 * on-demand drill-down ("which targets matched this search term?") — never
 * scanned by dashboard aggregates, which use the pre-aggregated
 * sp_search_term / sp_target_keyword tables. Indexes on (search_term) /
 * (target_value) keep filtered drill-down fast on 10M+ rows.
 */
export const KIND_RAW: KindSchema = {
  slug: "sp_raw",
  display_name: "종합 Report",
  description: "드릴다운 전용 — Search Term × Target Value 조합 raw 테이블",
  columns: [
    { column_name: "date", data_type: "timestamp", is_key: true, category: "dimension", ko: "날짜", source_headers: ["Date"] },
    { column_name: "campaign_name", data_type: "text", is_key: true, category: "dimension", ko: "캠페인 이름", source_headers: ["Campaign name"] },
    { column_name: "target_value", data_type: "text", is_key: true, category: "dimension", ko: "타겟 값", source_headers: ["Target value"] },
    { column_name: "target_match_type", data_type: "text", is_key: true, category: "dimension", ko: "매치 타입", source_headers: ["Target match type"] },
    {
      column_name: "search_term",
      data_type: "text",
      is_key: true,
      category: "dimension",
      ko: "검색어",
      source_headers: ["Search term", "Customer search term", "Matched target"],
    },
    { column_name: "budget_currency", data_type: "text", is_key: false, category: "dimension", ko: "통화", source_headers: ["Budget currency"] },
    { column_name: "impressions", data_type: "integer", is_key: false, category: "metric", ko: "노출수", source_headers: ["Impressions", "Gross impressions"] },
    { column_name: "clicks", data_type: "integer", is_key: false, category: "metric", ko: "클릭수", source_headers: ["Clicks", "Gross clicks"] },
    { column_name: "total_cost", data_type: "numeric", is_key: false, category: "metric", ko: "비용", source_headers: ["Total cost", "Cost", "Spend"] },
    { column_name: "sales", data_type: "numeric", is_key: false, category: "metric", ko: "매출", source_headers: ["Sales", "7 day total sales"] },
  ],
};

export const ALL_KINDS: KindSchema[] = [KIND_SEARCH_TERM, KIND_TARGET_KEYWORD, KIND_RAW];

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
