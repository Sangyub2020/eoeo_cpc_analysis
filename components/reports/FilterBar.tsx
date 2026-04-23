"use client";

import { Filter as FilterIcon, Calendar, RotateCcw } from "lucide-react";
import type { ReportColumn } from "@/lib/reports/types";
import type { FilterState } from "@/lib/reports/filter";
import DimensionFilter from "./DimensionFilter";

interface Props {
  slug: string;
  columns: ReportColumn[];
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  /** Optional counts to display */
  totalRows?: number;
  matchedRows?: number;
  /** Optional date bounds for date inputs */
  dateBounds?: { min: string | null; max: string | null };
  /** Hide text-column dimension filters (they may be rendered elsewhere, e.g. inside the chart header) */
  hideTextFilters?: boolean;
}

export default function FilterBar({
  slug,
  columns,
  filter,
  setFilter,
  totalRows,
  matchedRows,
  dateBounds,
  hideTextFilters,
}: Props) {
  const dateCol = columns.find(
    (c) => c.data_type === "date" || c.data_type === "timestamp",
  );
  const textCols = columns.filter((c) => c.data_type === "text");

  const active =
    !!filter.dateFrom ||
    !!filter.dateTo ||
    Object.values(filter.dimensions).some((v) => v.length > 0);

  function reset() {
    setFilter({
      dateColumn: filter.dateColumn,
      dateFrom: null,
      dateTo: null,
      dimensions: {},
    });
  }

  function setDim(col: string, vals: string[]) {
    const next = { ...filter.dimensions };
    if (vals.length === 0) delete next[col];
    else next[col] = vals;
    setFilter({ ...filter, dimensions: next });
  }

  return (
    <div className="p-4 rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl shadow-lg shadow-purple-500/10 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FilterIcon size={16} className="text-cyan-400" />
          <h3 className="font-medium text-sm text-gray-200">필터</h3>
          {matchedRows != null && totalRows != null && (
            <span className="text-xs text-gray-500">
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent font-semibold">
                {matchedRows.toLocaleString()}
              </span>
              {" "}/ {totalRows.toLocaleString()} 행
            </span>
          )}
        </div>
        {active && (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-cyan-300"
          >
            <RotateCcw size={12} /> 초기화
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {dateCol && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-purple-500/30 bg-slate-800 text-sm text-gray-200 focus-within:border-cyan-500">
            <Calendar size={14} className="text-gray-400" />
            <span className="text-gray-400">{dateCol.source_header}:</span>
            <input
              type="date"
              value={filter.dateFrom ?? ""}
              min={dateBounds?.min ?? undefined}
              max={dateBounds?.max ?? undefined}
              onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value || null })}
              className="bg-transparent border-none outline-none text-sm text-gray-200 [color-scheme:dark]"
            />
            <span className="text-gray-500">~</span>
            <input
              type="date"
              value={filter.dateTo ?? ""}
              min={dateBounds?.min ?? undefined}
              max={dateBounds?.max ?? undefined}
              onChange={(e) => setFilter({ ...filter, dateTo: e.target.value || null })}
              className="bg-transparent border-none outline-none text-sm text-gray-200 [color-scheme:dark]"
            />
          </div>
        )}

        {!hideTextFilters && textCols.map((col) => (
          <DimensionFilter
            key={col.column_name}
            slug={slug}
            column={col.column_name}
            label={col.source_header}
            filter={filter}
            selected={filter.dimensions[col.column_name] ?? []}
            onChange={(vals) => setDim(col.column_name, vals)}
          />
        ))}

        {!dateCol && (hideTextFilters || textCols.length === 0) && (
          <span className="text-sm text-gray-500">필터링 가능한 열이 없습니다.</span>
        )}
      </div>
    </div>
  );
}
