export type DataType =
  | "text"
  | "numeric"
  | "integer"
  | "date"
  | "timestamp"
  | "boolean";

export interface ReportType {
  id: string;
  slug: string;
  display_name: string;
  table_name: string;
  key_columns: string[];
  created_at: string;
  /** Optional grouping tag so two complementary uploads (e.g. a brand's
   *  search-term export + target-keyword export) render as one dashboard. */
  brand: string | null;
}

export interface ReportColumn {
  id: string;
  report_type_id: string;
  column_name: string;
  source_header: string;
  data_type: DataType;
  is_key: boolean;
  position: number;
}

export interface ParsedFile {
  headers: string[];
  rows: Record<string, unknown>[];
  sampleRows: Record<string, unknown>[];
  /** Row index (0-based) in the original sheet that was used as the header row */
  headerRowIndex: number;
  /** First 15 rows of the raw sheet (array-of-arrays) so the UI can let the user re-pick the header row */
  previewRows: unknown[][];
}

/** One header's plan as resolved on the client, sent to /api/reports/commit */
export interface HeaderPlan {
  source_header: string;
  column_name: string;   // sanitized
  data_type: DataType;
  is_key: boolean;
  is_new: boolean;       // true if DB didn't have this column yet
  include: boolean;      // user can opt out (skip the column entirely)
}

export interface PreviewResponse {
  headers: string[];
  sampleRows: Record<string, unknown>[];
  totalRows: number;
  suggested: HeaderPlan[];
  // If an existing report type matches, these come from DB
  existingType?: ReportType | null;
  existingColumns?: ReportColumn[];
}
