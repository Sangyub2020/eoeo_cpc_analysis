"use client";

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, Loader2 } from "lucide-react";
import type { ReportColumn } from "@/lib/reports/types";
import type { FilterState } from "@/lib/reports/filter";
import { fmtShortDate } from "@/lib/reports/format";
import { cn } from "@/lib/utils";

interface Props {
  slug: string;
  columns: ReportColumn[];
  visibleColumns: string[];
  filter: FilterState;
}

const PAGE_SIZE = 100;

export default function DataTable({ slug, columns, visibleColumns, filter }: Props) {
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to page 0 when filter / sort changes
  useEffect(() => {
    setPage(0);
  }, [filter, sort]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/reports/${slug}/rows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filter,
        select: visibleColumns,
        orderBy: sort ? { column: sort.col, dir: sort.dir } : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setRows(j.rows ?? []);
        setTotal(j.total == null ? null : Number(j.total));
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "조회 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [slug, filter, visibleColumns, sort, page]);

  const cols = columns.filter((c) => visibleColumns.includes(c.column_name));
  // total may be null when the filtered count was too expensive to compute
  // (big table with filter); default to a large pageable max so the user can
  // still navigate forward until data runs out.
  const maxPage =
    total == null
      ? 999
      : Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  function toggleSort(col: string) {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  }

  function formatValue(v: unknown, type: string): string {
    if (v == null) return "";
    if (type === "numeric" || type === "integer") {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) return n.toLocaleString();
    }
    if (type === "date" || type === "timestamp") return fmtShortDate(v);
    return String(v);
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-auto border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl rounded-lg shadow-lg shadow-purple-500/10 max-h-[65vh]">
        {loading && (
          <div className="absolute top-0 right-0 p-2 z-10">
            <Loader2 size={14} className="animate-spin text-cyan-400" />
          </div>
        )}
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-gray-300 text-sm font-medium border-b border-purple-500/20 sticky top-0">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.column_name}
                  onClick={() => toggleSort(c.column_name)}
                  className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-white/5 whitespace-nowrap transition-colors"
                >
                  <div className="inline-flex items-center gap-1">
                    {c.source_header}
                    {sort?.col === c.column_name ? (
                      sort.dir === "asc" ? (
                        <ArrowUp size={12} className="text-cyan-300" />
                      ) : (
                        <ArrowDown size={12} className="text-cyan-300" />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="text-gray-500" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-4 text-center text-rose-400 text-sm">
                  {error}
                </td>
              </tr>
            ) : rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-4 text-center text-gray-500 text-sm">
                  결과가 없습니다
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={i}
                  className={cn(
                    "border-b border-gray-700/50 hover:bg-white/5 text-gray-300 transition-colors",
                  )}
                >
                  {cols.map((c) => (
                    <td
                      key={c.column_name}
                      className={cn(
                        "px-4 py-3 whitespace-nowrap",
                        (c.data_type === "numeric" || c.data_type === "integer") &&
                          "text-right tabular-nums text-gray-100",
                      )}
                    >
                      {formatValue(r[c.column_name], c.data_type)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-400">
        <span>
          {total == null ? (
            <>
              {(page * PAGE_SIZE + 1).toLocaleString()}–
              {(page * PAGE_SIZE + rows.length).toLocaleString()} 행
              <span className="text-gray-500"> (총계 생략 — 대용량)</span>
            </>
          ) : (
            <>
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent font-semibold">
                {total.toLocaleString()}
              </span>
              행 중{" "}
              {total === 0 ? "0" : (page * PAGE_SIZE + 1).toLocaleString()}–
              {Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()}
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 py-1 rounded-md border border-cyan-500/30 bg-black/40 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
          >
            이전
          </button>
          <span className="text-gray-300">
            {page + 1} / {maxPage + 1}
          </span>
          <button
            disabled={page >= maxPage || loading}
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            className="px-3 py-1 rounded-md border border-cyan-500/30 bg-black/40 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
          >
            다음
          </button>
        </div>
      </div>
    </div>
  );
}
