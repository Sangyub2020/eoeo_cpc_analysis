"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { FilterState } from "@/lib/reports/filter";

interface DrillRow {
  value: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  roas: number | null;
}

interface Props {
  brand: string;
  /** What axis the user clicked ON (the filter). */
  filterBy: "search_term" | "target_value";
  value: string;
  /** What to group the output by. Typically the other axis. */
  groupBy: "search_term" | "target_value";
  /** Date-range context (optional) — propagated to the drill API so the
   *  breakdown respects the current dashboard time window. */
  filter?: FilterState;
  onClose: () => void;
}

type SortKey = "cost" | "sales" | "roas" | "clicks" | "impressions";

const LABEL_BY_COL: Record<string, string> = {
  search_term: "Customer Search term",
  target_value: "Target value",
};

export default function DrillDownModal({
  brand,
  filterBy,
  value,
  groupBy,
  filter,
  onClose,
}: Props) {
  const [rows, setRows] = useState<DrillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("sales");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setHasCompleted(false);
    setError(null);
    setRows([]);
    fetch(`/api/brands/${encodeURIComponent(brand)}/drill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filterBy, value, groupBy, filter, limit: 2000 }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (abort.signal.aborted) return;
        if (j.error) throw new Error(j.error);
        setRows(j.rows ?? []);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        if (abort.signal.aborted) return;
        setError(e instanceof Error ? e.message : "드릴다운 실패");
      })
      .finally(() => {
        // Skip state flips when this effect was already torn down — otherwise
        // an aborted fetch briefly flashes "결과 없음" between renders.
        if (abort.signal.aborted) return;
        setLoading(false);
        setHasCompleted(true);
      });
    return () => abort.abort();
  }, [brand, filterBy, value, groupBy, filter]);

  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const sorted = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return (Number(av) - Number(bv)) * mul;
    });
  }, [rows, sortKey, sortDir]);

  const totals = useMemo(() => {
    let imp = 0,
      clk = 0,
      cost = 0,
      sales = 0;
    for (const r of rows) {
      imp += r.impressions;
      clk += r.clicks;
      cost += r.cost;
      sales += r.sales;
    }
    return { imp, clk, cost, sales, roas: cost > 0 ? sales / cost : null };
  }, [rows]);

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const filterLabel = LABEL_BY_COL[filterBy] ?? filterBy;
  const groupLabel = LABEL_BY_COL[groupBy] ?? groupBy;

  const body = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-lg border border-purple-500/30 bg-slate-900 shadow-2xl shadow-cyan-500/10">
        <div className="px-5 py-3 border-b border-purple-500/20 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-500 uppercase tracking-wide">
              {filterLabel}
            </div>
            <div
              className="text-base font-semibold text-gray-100 truncate mt-0.5"
              title={value}
            >
              {value}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              → 매칭된 <span className="text-cyan-300">{groupLabel}</span> 별 breakdown
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-rose-300 hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-auto">
          {loading || !hasCompleted ? (
            <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
              <Loader2 size={14} className="animate-spin text-cyan-400" /> 결과 로딩 중...
            </div>
          ) : error ? (
            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-sm text-gray-500 text-center">
              매칭된 결과가 없습니다.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr className="text-left text-gray-500 uppercase tracking-wide text-[10px] border-b border-purple-500/20">
                  <th className="py-2 pr-2">{groupLabel}</th>
                  <ThSort label="Impressions" myKey="impressions" activeKey={sortKey} dir={sortDir} onClick={handleSort} />
                  <ThSort label="Clicks" myKey="clicks" activeKey={sortKey} dir={sortDir} onClick={handleSort} />
                  <ThSort label="Cost" myKey="cost" activeKey={sortKey} dir={sortDir} onClick={handleSort} />
                  <ThSort label="Sales" myKey="sales" activeKey={sortKey} dir={sortDir} onClick={handleSort} />
                  <ThSort label="ROAS" myKey="roas" activeKey={sortKey} dir={sortDir} onClick={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr
                    key={(r.value ?? "_null") + "_" + i}
                    className="border-b border-purple-500/10 hover:bg-white/5"
                  >
                    <td className="py-1.5 pr-2 text-gray-200 font-mono text-[11px] max-w-[320px] truncate" title={r.value ?? ""}>
                      {r.value ?? <span className="italic text-gray-500">(null)</span>}
                    </td>
                    <td className="py-1.5 text-right text-gray-400 tabular-nums">
                      {r.impressions.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-gray-400 tabular-nums">
                      {r.clicks.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-gray-400 tabular-nums">
                      {fmtMoney(r.cost)}
                    </td>
                    <td className="py-1.5 text-right text-gray-400 tabular-nums">
                      {fmtMoney(r.sales)}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        r.roas == null
                          ? "text-gray-500"
                          : r.roas >= 1
                            ? "text-emerald-300"
                            : "text-rose-300"
                      }`}
                    >
                      {r.roas != null ? r.roas.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-slate-900">
                <tr className="border-t border-purple-500/30 font-semibold text-gray-200">
                  <td className="py-2 pr-2 text-[11px] uppercase tracking-wide text-gray-400">
                    합계 ({rows.length}개)
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {totals.imp.toLocaleString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {totals.clk.toLocaleString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {fmtMoney(totals.cost)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-cyan-300">
                    {fmtMoney(totals.sales)}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${
                      totals.roas == null
                        ? "text-gray-500"
                        : totals.roas >= 1
                          ? "text-emerald-300"
                          : "text-rose-300"
                    }`}
                  >
                    {totals.roas != null ? totals.roas.toFixed(2) : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}

function ThSort({
  label,
  myKey,
  activeKey,
  dir,
  onClick,
}: {
  label: string;
  myKey: SortKey;
  activeKey: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}) {
  const active = activeKey === myKey;
  return (
    <th className="py-2 text-right">
      <button
        onClick={() => onClick(myKey)}
        className={`inline-flex items-center gap-0.5 ${active ? "text-cyan-300" : "hover:text-gray-300"}`}
      >
        <span>{label}</span>
        {active ? (
          dir === "asc" ? (
            <ArrowUp size={9} />
          ) : (
            <ArrowDown size={9} />
          )
        ) : (
          <ArrowUpDown size={9} className="opacity-40" />
        )}
      </button>
    </th>
  );
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return "$" + Math.round(n).toLocaleString();
  if (abs >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}
