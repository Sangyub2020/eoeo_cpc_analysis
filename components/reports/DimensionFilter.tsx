"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Loader2, X } from "lucide-react";
import type { FilterState } from "@/lib/reports/filter";

interface Props {
  slug: string;
  column: string;
  label: string;
  /** Other active filters — excluded automatically on the server for this column's query */
  filter: FilterState;
  selected: string[];
  onChange: (values: string[]) => void;
  /** Optional metric shown next to each value (e.g. "140행 · $1,234"). Also switches order to metric desc. */
  metric?: { col: string; fn: "sum" | "avg" | "min" | "max" | "count"; label?: string };
}

const VISIBLE_LIMIT = 500;
const MENU_WIDTH = 384; // w-96

export default function DimensionFilter({ slug, column, label, filter, selected, onChange, metric }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<{ value: string | null; count: number; metric?: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the portal-rendered menu under the trigger, staying inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left;
      if (left + MENU_WIDTH + 8 > vw) left = Math.max(8, vw - MENU_WIDTH - 8);
      let top = rect.bottom + 4;
      // flip upward if not enough room below (try a 340px estimate)
      if (top + 340 > vh && rect.top - 340 > 0) top = rect.top - 340 - 4;
      setPos({ top, left });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Close on outside click (check BOTH the trigger and the portal menu, since they're in separate DOM subtrees).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Hold the latest filter in a ref so the fetch sees the current value without
  // having `filter` in the effect deps (toggling this column's checkbox mutates
  // `filter.dimensions[column]` but that sub-field is ignored server-side anyway).
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // A key that reflects ONLY filter pieces affecting this column's distinct query —
  // i.e., everything except this column's own selection. Changes here trigger a refetch;
  // toggling checkboxes in this dropdown does NOT.
  const otherFilterKey = useMemo(() => {
    const dims = { ...(filter.dimensions ?? {}) };
    delete dims[column];
    return JSON.stringify({
      dateColumn: filter.dateColumn,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      dimensions: dims,
    });
  }, [filter, column]);

  const metricKey = metric ? `${metric.col}|${metric.fn}` : "";

  // Fetch distinct values only when the dropdown opens, the search query changes,
  // or an *other* filter changes. Show loading overlay without clobbering the list
  // (stale-while-revalidate), so the UI doesn't flash blank mid-toggle.
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/reports/${slug}/distinct`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          column,
          filter: filterRef.current,
          query,
          limit: VISIBLE_LIMIT,
          metric: metric ? { col: metric.col, fn: metric.fn } : undefined,
        }),
        signal: abort.signal,
      })
        .then((r) => r.json())
        .then((j) => {
          setValues(j.values ?? []);
          setTotal(j.values?.length ?? 0);
        })
        .catch((e) => {
          if (e.name === "AbortError") return;
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      clearTimeout(t);
      abort.abort();
    };
  }, [open, query, slug, column, otherFilterKey, metricKey]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const [lastCopied, setLastCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!lastCopied) return;
    const t = setTimeout(() => setLastCopied(null), 1500);
    return () => clearTimeout(t);
  }, [lastCopied]);

  async function copyValue(v: string) {
    try {
      await navigator.clipboard.writeText(v);
      setLastCopied(v);
    } catch {
      setLastCopied(null);
    }
  }

  function toggle(v: string) {
    if (selectedSet.has(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  }
  function clearAll() {
    onChange([]);
  }
  function selectVisible() {
    const set = new Set(selected);
    for (const d of values) {
      if (d.value != null) set.add(d.value);
    }
    onChange(Array.from(set));
  }

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-[9999] rounded-lg border border-purple-500/30 bg-slate-800 shadow-xl"
          >
            <div className="p-2 border-b border-purple-500/20">
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="값 검색 (대소문자 무시)"
                  className="w-full pl-7 pr-2 py-1.5 text-sm rounded-lg border border-purple-500/30 bg-slate-900 text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-72 overflow-auto relative">
              {loading && values.length > 0 && (
                <div className="absolute top-1 right-2 z-10 text-cyan-400" title="새로 고치는 중">
                  <Loader2 size={12} className="animate-spin" />
                </div>
              )}
              {loading && values.length === 0 ? (
                <div className="p-6 flex items-center justify-center text-gray-400 text-sm">
                  <Loader2 size={14} className="animate-spin mr-2 text-cyan-400" /> 불러오는 중...
                </div>
              ) : values.length === 0 ? (
                <div className="p-3 text-sm text-gray-500 text-center">일치하는 값이 없습니다</div>
              ) : (
                values.map((d, i) => {
                  const checked = d.value != null && selectedSet.has(d.value);
                  return (
                    <label
                      key={(d.value ?? "") + "_" + i}
                      onContextMenu={(e) => {
                        if (d.value != null) {
                          e.preventDefault();
                          void copyValue(d.value);
                        }
                      }}
                      className={`flex items-center gap-2 px-2 py-1 text-sm hover:bg-white/5 cursor-pointer ${checked ? "text-cyan-300" : "text-gray-300"}`}
                      title={d.value ? `${d.value}\n(우클릭: 복사)` : "(null)"}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => d.value != null && toggle(d.value)}
                        className="accent-cyan-500"
                      />
                      <span className="flex-1 truncate">
                        {d.value ?? <em className="text-gray-500">(null)</em>}
                      </span>
                      <span className="text-xs text-gray-500 tabular-nums shrink-0">
                        {d.count.toLocaleString()}행
                      </span>
                      {metric && (
                        <span
                          className="text-xs text-cyan-300/80 tabular-nums shrink-0 min-w-[72px] text-right"
                          title={`${metric.label ?? metric.col} (${metric.fn})`}
                        >
                          {fmtMetric(d.metric)}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {total === VISIBLE_LIMIT && (
              <div className="p-2 text-xs text-gray-500 text-center border-t border-purple-500/20">
                상위 {VISIBLE_LIMIT.toLocaleString()} 건만 표시 — 검색으로 좁혀보세요
              </div>
            )}

            {lastCopied ? (
              <div className="px-3 py-1.5 border-t border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300 truncate">
                복사됨: {lastCopied}
              </div>
            ) : (
              <div className="px-3 py-1 border-t border-purple-500/10 text-[10px] text-gray-500">
                💡 항목 <strong className="text-gray-400">우클릭</strong>으로 이름 복사
              </div>
            )}

            <div className="p-2 border-t border-purple-500/20 flex justify-between text-xs">
              <button onClick={clearAll} className="text-gray-400 hover:text-cyan-300">
                모두 해제
              </button>
              <button onClick={selectVisible} className="text-gray-400 hover:text-cyan-300">
                보이는 것 선택
              </button>
              <button
                onClick={() => setOpen(false)}
                className="font-medium text-cyan-300 hover:text-cyan-200"
              >
                닫기
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="inline-flex items-center" ref={triggerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-purple-500/30 bg-slate-800 text-sm text-gray-200 hover:border-cyan-500/50 transition-colors"
      >
        <span className="text-gray-400">{label}:</span>
        {selected.length ? (
          <span className="font-medium text-cyan-300">{selected.length}개 선택</span>
        ) : (
          <span className="text-gray-400">전체</span>
        )}
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {selected.length > 0 && (
        <button
          onClick={clearAll}
          className="ml-1 text-gray-400 hover:text-rose-300"
          title="필터 해제"
        >
          <X size={14} />
        </button>
      )}

      {menu}
    </div>
  );
}

function fmtMetric(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return Math.round(n).toLocaleString();
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}
