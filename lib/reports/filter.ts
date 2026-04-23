export interface FilterState {
  dateColumn: string | null;
  dateFrom: string | null;  // YYYY-MM-DD
  dateTo: string | null;    // YYYY-MM-DD
  dimensions: Record<string, string[]>; // column_name -> selected values (empty = no filter on this column)
}

export function emptyFilter(): FilterState {
  return { dateColumn: null, dateFrom: null, dateTo: null, dimensions: {} };
}

/** Apply a filter state to an array of rows. */
export function applyFilter(
  rows: Record<string, unknown>[],
  filter: FilterState,
): Record<string, unknown>[] {
  const setsByCol: Record<string, Set<string>> = {};
  for (const [col, vals] of Object.entries(filter.dimensions)) {
    if (vals.length) setsByCol[col] = new Set(vals);
  }
  const hasDim = Object.keys(setsByCol).length > 0;
  const hasDateCheck = !!(filter.dateColumn && (filter.dateFrom || filter.dateTo));

  if (!hasDim && !hasDateCheck) return rows;

  return rows.filter((r) => {
    if (hasDateCheck && filter.dateColumn) {
      const v = r[filter.dateColumn];
      const s = v == null ? "" : String(v).slice(0, 10);
      if (filter.dateFrom && s < filter.dateFrom) return false;
      if (filter.dateTo && s > filter.dateTo) return false;
    }
    for (const col in setsByCol) {
      const v = r[col];
      const s = v == null ? "" : String(v);
      if (!setsByCol[col].has(s)) return false;
    }
    return true;
  });
}
