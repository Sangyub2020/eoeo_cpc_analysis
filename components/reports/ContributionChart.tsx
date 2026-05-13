"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
} from "recharts";
import { Loader2, Search, ArrowUp, ArrowDown, ArrowUpDown, Crosshair } from "lucide-react";
import AsinLinkified from "@/components/reports/AsinLinkified";
import CumulativeDistributionModal from "@/components/reports/CumulativeDistributionModal";
import type { FilterState } from "@/lib/reports/filter";
import type { ReportColumn } from "@/lib/reports/types";
import { fmtShortDate } from "@/lib/reports/format";
import { eventColors, type BrandEvent } from "@/lib/reports/brand-events";

const COLORS = [
  "#22d3ee", "#a855f7", "#10b981", "#f59e0b", "#f43f5e",
  "#38bdf8", "#84cc16", "#e879f9", "#fb7185", "#fbbf24",
  "#06b6d4", "#8b5cf6", "#14b8a6", "#eab308", "#ec4899",
  "#0ea5e9", "#65a30d", "#d946ef", "#f97316", "#3b82f6",
  "#2dd4bf", "#c084fc", "#4ade80", "#fb923c", "#e11d48",
];

const DEFAULT_STACK_COL = "search_term";
const METRIC_COL = "sales";
const COST_COL = "total_cost";
const METRIC_FN = "sum" as const;

export interface SharedTermStat {
  value: string;
  cost: number;
  sales: number;
  roas: number | null;
}

interface Props {
  slug: string;
  columns: ReportColumn[];
  filter: FilterState;
  topN: number;
  setTopN: (n: number) => void;
  sharedTerms: SharedTermStat[];
  hidden: Set<string>;
  setHidden: (h: Set<string>) => void;
  termsLoading: boolean;
  /** Which text column to stack by. Defaults to "search_term". */
  stackColumn?: string;
  /** Optional drill-down handler — when present the TermPanel shows a 🎯
   *  button per row that fires this with the term's value. */
  onDrill?: (value: string) => void;
  /** 브랜드 페이지의 이벤트 — X축 음영으로 표시. */
  events?: BrandEvent[];
}

export default function ContributionChart({
  slug,
  columns,
  filter,
  topN,
  setTopN,
  sharedTerms,
  hidden,
  setHidden,
  termsLoading,
  stackColumn = DEFAULT_STACK_COL,
  onDrill,
  events,
}: Props) {
  const STACK_COL = stackColumn;
  const stackCol = columns.find((c) => c.column_name === STACK_COL);
  const metricCol = columns.find((c) => c.column_name === METRIC_COL);
  const xCol = columns.find((c) => c.data_type === "date" || c.data_type === "timestamp");

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [perTermDaily, setPerTermDaily] = useState<
    Map<string, { date: string; sales: number; cost: number }[]>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDistribution, setShowDistribution] = useState(false);

  const baseFilter = useMemo(() => {
    const dims = Object.fromEntries(
      Object.entries(filter.dimensions ?? {}).filter(([c]) => c !== STACK_COL),
    );
    return { ...filter, dimensions: dims };
  }, [filter]);
  const baseFilterKey = useMemo(() => JSON.stringify(baseFilter), [baseFilter]);
  const termsKey = useMemo(
    () => sharedTerms.map((t) => t.value).join("|"),
    [sharedTerms],
  );

  useEffect(() => {
    if (!stackCol || !metricCol || !xCol) return;
    if (sharedTerms.length === 0) {
      setRows([]);
      setPerTermDaily(new Map());
      return;
    }
    const abort = new AbortController();
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const aggRes = await fetch(`/api/reports/${slug}/aggregate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filter: {
              ...baseFilter,
              dimensions: {
                ...(baseFilter.dimensions ?? {}),
                [STACK_COL]: sharedTerms.map((t) => t.value),
              },
            },
            xColumn: xCol.column_name,
            groupColumn: STACK_COL,
            metrics: [
              { col: METRIC_COL, fn: METRIC_FN },
              { col: COST_COL, fn: METRIC_FN },
            ],
            limit: 20000,
          }),
          signal: abort.signal,
        });
        const aggJson = await aggRes.json();
        if (!aggRes.ok) throw new Error(aggJson.error ?? `aggregate HTTP ${aggRes.status}`);

        const byX = new Map<string, Record<string, unknown>>();
        const perTerm = new Map<string, { date: string; sales: number; cost: number }[]>();
        for (const r of (aggJson.rows ?? []) as {
          x: string;
          g?: string;
          m0?: number;
          m1?: number;
        }[]) {
          const xk = String(r.x);
          const term = String(r.g ?? "");
          const sales = r.m0 == null ? 0 : Number(r.m0);
          const cost = r.m1 == null ? 0 : Number(r.m1);
          let out = byX.get(xk);
          if (!out) {
            out = { x: r.x };
            byX.set(xk, out);
          }
          out[term] = r.m0 == null ? null : sales;
          const list = perTerm.get(term) ?? [];
          list.push({ date: xk, sales, cost });
          perTerm.set(term, list);
        }
        const chartRows = Array.from(byX.values()).sort((a, b) =>
          String(a.x) < String(b.x) ? -1 : 1,
        );

        if (!cancelled) {
          setRows(chartRows);
          setPerTermDaily(perTerm);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (!cancelled) setError(e instanceof Error ? e.message : "조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, baseFilterKey, termsKey]);

  // Monthly overlay — ONLY when exactly one term is visible.
  const monthlyBuckets = useMemo(() => {
    const visibleTerms = sharedTerms.filter((t) => !hidden.has(t.value));
    if (visibleTerms.length !== 1) return [];
    const termName = visibleTerms[0].value;
    const daily = perTermDaily.get(termName);
    if (!daily || daily.length === 0) return [];

    const byMonth = new Map<
      string,
      { dates: Set<string>; salesSum: number; costSum: number }
    >();
    for (const r of daily) {
      const bucket = monthBucketStart(r.date);
      let w = byMonth.get(bucket);
      if (!w) {
        w = { dates: new Set(), salesSum: 0, costSum: 0 };
        byMonth.set(bucket, w);
      }
      w.dates.add(r.date);
      if (Number.isFinite(r.sales)) w.salesSum += r.sales;
      if (Number.isFinite(r.cost)) w.costSum += r.cost;
    }
    const sorted = Array.from(byMonth.keys()).sort();
    const years = new Set(sorted.map((s) => s.slice(0, 4)));
    const multiYear = years.size > 1;
    return sorted.map((bucket) => {
      const b = byMonth.get(bucket)!;
      const dates = Array.from(b.dates).sort();
      const days = b.dates.size;
      return {
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        label: monthLabel(bucket, multiYear),
        avgSales: days > 0 ? b.salesSum / days : 0,
        days,
        roas: b.costSum > 0 ? b.salesSum / b.costSum : null,
      };
    });
  }, [sharedTerms, hidden, perTermDaily]);

  if (!stackCol || !metricCol || !xCol) return null;

  const totalSum = sharedTerms.reduce((a, b) => a + (b.sales ?? 0), 0);
  const stackLabel = stackCol.source_header;
  const metricLabel = metricCol.source_header;
  const busy = termsLoading || loading;

  function toggleTerm(v: string) {
    const next = new Set(hidden);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setHidden(next);
  }
  function toggleAll() {
    if (hidden.size === 0) setHidden(new Set(sharedTerms.map((t) => t.value)));
    else setHidden(new Set());
  }

  const colorOf = (term: string) => {
    const idx = sharedTerms.findIndex((t) => t.value === term);
    return COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
  };

  return (
    <div className="p-4 rounded-lg border border-purple-500/20 bg-slate-900/80 shadow-lg shadow-purple-500/10 text-gray-300 relative z-20">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-gray-100">
          일자별 {stackLabel} 매출 <span className="text-gray-500">({metricLabel} 기준)</span>
        </h3>
        <div className="inline-flex items-center gap-2 text-xs">
          <span className="text-gray-400">Top</span>
          <input
            type="number"
            value={topN}
            min={1}
            max={2000}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              setTopN(Math.max(1, Math.min(2000, Math.round(n))));
            }}
            className="w-16 rounded-md border border-purple-500/30 bg-slate-800 text-gray-200 px-2 py-1 text-xs focus:border-cyan-500 focus:outline-none"
          />
          <span className="text-gray-400">개</span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowDistribution(true)}
          className="text-xs text-gray-400 hover:text-cyan-200 transition cursor-pointer underline-offset-2 decoration-dotted decoration-cyan-500/40 hover:underline"
          title={`전체 ${stackLabel} 매출 분포 보기 (long-tail / 집중도)`}
        >
          Top {sharedTerms.length} {metricLabel} 합계:{" "}
          <span className="text-cyan-300 font-semibold tabular-nums">{fmtTotal(totalSum)}</span>
          {busy && <Loader2 size={10} className="inline ml-2 animate-spin text-cyan-400" />}
        </button>
      </div>

      {showDistribution && (
        <CumulativeDistributionModal
          slug={slug}
          column={STACK_COL}
          metric={{ col: METRIC_COL, fn: METRIC_FN }}
          filter={filter}
          topN={topN}
          stackLabel={stackLabel}
          metricLabel={metricLabel}
          onClose={() => setShowDistribution(false)}
        />
      )}

      <div className="flex gap-3 h-[520px]">
        <div className="flex-1 h-full relative min-w-0">
          {error ? (
            <div className="h-full flex items-center justify-center text-sm text-rose-400">{error}</div>
          ) : rows.length === 0 && !busy ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              데이터가 없습니다.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="x" tickFormatter={fmtShortDate} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    padding: "6px 8px",
                    lineHeight: 1.4,
                    maxHeight: 320,
                    overflowY: "auto",
                  }}
                  itemStyle={{ padding: 0 }}
                  labelStyle={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}
                  labelFormatter={(v) => fmtShortDate(v)}
                  formatter={(value, name, _item, _idx, payload) => {
                    const n = typeof value === "number" ? value : Number(value);
                    const total = Array.isArray(payload)
                      ? (payload as Array<{ value?: unknown }>).reduce((s, p) => {
                          const v = Number(p.value);
                          return s + (Number.isFinite(v) ? v : 0);
                        }, 0)
                      : 0;
                    const pct = total > 0 && Number.isFinite(n) ? (n / total) * 100 : null;
                    const valStr = fmtTotal(n);
                    return [pct != null ? `${valStr} · ${pct.toFixed(1)}%` : valStr, name];
                  }}
                  itemSorter={(item) => -Number(item.value ?? 0)}
                  wrapperStyle={{ zIndex: 9999, pointerEvents: "none" }}
                  allowEscapeViewBox={{ x: true, y: true }}
                />
                {(events ?? []).map((e) => {
                  const c = eventColors(e.color);
                  return (
                    <ReferenceArea
                      key={`evt-${e.id}`}
                      x1={e.start_date}
                      x2={e.end_date}
                      fill={c.fill}
                      stroke={c.stroke}
                      strokeDasharray="2 2"
                      ifOverflow="hidden"
                      label={{
                        position: "insideTop",
                        content: (props) => {
                          const vb = (props as { viewBox?: { x?: number; y?: number; width?: number; height?: number } }).viewBox;
                          if (
                            !vb ||
                            vb.x == null ||
                            vb.y == null ||
                            vb.width == null ||
                            vb.height == null
                          ) {
                            return null;
                          }
                          const cx = vb.x + vb.width / 2;
                          const baselineY = vb.y + 14;
                          return (
                            <text
                              x={cx}
                              y={baselineY}
                              textAnchor="middle"
                              fontSize={11}
                              fontWeight={700}
                              fill={e.color}
                              stroke="#0f172a"
                              strokeWidth={3}
                              strokeLinejoin="round"
                              paintOrder="stroke"
                            >
                              {e.name}
                            </text>
                          );
                        },
                      }}
                    />
                  );
                })}
                {monthlyBuckets.map((b) => (
                  <ReferenceArea
                    key={b.firstDate + "_bg"}
                    x1={b.firstDate}
                    x2={b.lastDate}
                    fill="rgba(168, 85, 247, 0.04)"
                    stroke="rgba(168, 85, 247, 0.2)"
                    strokeDasharray="2 3"
                    ifOverflow="hidden"
                  />
                ))}
                {sharedTerms.map((t) => {
                  if (hidden.has(t.value)) return null;
                  return (
                    <Bar
                      key={t.value}
                      dataKey={t.value}
                      stackId="a"
                      fill={colorOf(t.value)}
                    />
                  );
                })}
                {monthlyBuckets.map((b) => (
                  <ReferenceArea
                    key={b.firstDate + "_lbl"}
                    x1={b.firstDate}
                    x2={b.lastDate}
                    fill="transparent"
                    stroke="none"
                    ifOverflow="hidden"
                    label={{
                      position: "insideTop",
                      content: (props) => {
                        const vb = (props as { viewBox?: { x?: number; y?: number; width?: number } }).viewBox;
                        if (!vb || vb.x == null || vb.y == null || vb.width == null) return null;
                        const cx = vb.x + vb.width / 2;
                        const topY = vb.y + 14;
                        return (
                          <g>
                            <text
                              x={cx}
                              y={topY}
                              textAnchor="middle"
                              fontSize={12}
                              fontWeight={700}
                              fill="#ffffff"
                              stroke="#0f172a"
                              strokeWidth={3}
                              strokeLinejoin="round"
                              paintOrder="stroke"
                            >
                              {b.label} · 일평균 {fmtAvgMoney(b.avgSales)}
                            </text>
                            {b.roas != null && (
                              <text
                                x={cx}
                                y={topY + 16}
                                textAnchor="middle"
                                fontSize={12}
                                fontWeight={700}
                                fill="#fbbf24"
                                stroke="#0f172a"
                                strokeWidth={3}
                                strokeLinejoin="round"
                                paintOrder="stroke"
                              >
                                ROAS {b.roas.toFixed(2)}
                              </text>
                            )}
                          </g>
                        );
                      },
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <TermPanel
          stackLabel={stackLabel}
          terms={sharedTerms}
          hidden={hidden}
          toggleTerm={toggleTerm}
          toggleAll={toggleAll}
          onDrill={onDrill}
        />
      </div>
    </div>
  );
}

/**
 * Shared right-side term panel used by both ContributionChart and RoasChart.
 * Columns: Search term | Cost | Sales | ROAS.
 */
type SortKey = "cost" | "sales" | "roas" | null;
type SortDir = "asc" | "desc";

const PANEL_WIDTH_STORAGE_KEY = "termPanel.width";
const PANEL_WIDTH_MIN = 320;
const PANEL_WIDTH_MAX = 900;
const PANEL_WIDTH_DEFAULT = 400;

export function TermPanel({
  stackLabel,
  terms,
  hidden,
  toggleTerm,
  toggleAll,
  onDrill,
}: {
  stackLabel: string;
  terms: SharedTermStat[];
  hidden: Set<string>;
  toggleTerm: (v: string) => void;
  toggleAll: () => void;
  /** When provided, shows a 🎯 button next to each term that fires the drill
   *  callback. Caller decides what to open (modal, side panel, etc.). */
  onDrill?: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Panel width — user drags the left edge to widen the term name column.
  // Persisted so both the search-term and target-value panels share the setting.
  const [panelWidth, setPanelWidth] = useState<number>(PANEL_WIDTH_DEFAULT);
  useEffect(() => {
    const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= PANEL_WIDTH_MIN && n <= PANEL_WIDTH_MAX) {
      setPanelWidth(n);
    }
  }, []);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      // Dragging left (ev.clientX < startX) widens the panel.
      const next = Math.max(
        PANEL_WIDTH_MIN,
        Math.min(PANEL_WIDTH_MAX, startW + (startX - ev.clientX)),
      );
      setPanelWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.localStorage.setItem(
        PANEL_WIDTH_STORAGE_KEY,
        String(Math.round(panelWidthRef.current)),
      );
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  // Keep a ref in sync so the mouseup handler sees the final width.
  const panelWidthRef = useRef(panelWidth);
  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  // Right-click copy feedback — shows "복사됨" pill for 1.5s next to the row.
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  async function copyValue(e: React.MouseEvent, value: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.setTimeout(
        () => setCopiedValue((k) => (k === value ? null : k)),
        1500,
      );
    } catch {
      // Clipboard API unavailable — silently ignore.
    }
  }

  const totalSales = terms.reduce(
    (s, t) => s + (Number.isFinite(t.sales) ? t.sales : 0),
    0,
  );

  // Color is bound to the term's ORIGINAL rank (so sorting the panel doesn't
  // reassign colors and break sync with the chart).
  const colorByValue = useMemo(() => {
    const m = new Map<string, string>();
    terms.forEach((t, i) => m.set(t.value, COLORS[i % COLORS.length]));
    return m;
  }, [terms]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? terms.filter((t) => t.value.toLowerCase().includes(q)) : terms;
    if (!sortKey) return base;
    const pick = (t: SharedTermStat): number | null =>
      sortKey === "cost" ? t.cost : sortKey === "sales" ? t.sales : t.roas;
    const mul = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last
      if (bv == null) return -1;
      return (av - bv) * mul;
    });
  }, [terms, search, sortKey, sortDir]);

  function handleSortClick(k: Exclude<SortKey, null>) {
    if (sortKey === k) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  return (
    <div
      className="relative shrink-0 h-full border border-purple-500/20 rounded-md bg-slate-900/40 flex flex-col"
      style={{ width: panelWidth }}
    >
      <div
        onMouseDown={startResize}
        className="absolute top-0 left-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-cyan-400/40 active:bg-cyan-400/60 z-10"
        title="드래그해서 키워드 영역 너비 조절"
      />
      <div className="px-3 py-2 border-b border-purple-500/20 flex items-center justify-between text-xs">
        <span className="text-gray-400">
          {stackLabel}{" "}
          <span className="text-gray-500">
            ({terms.length - hidden.size}/{terms.length})
          </span>
        </span>
        <button
          onClick={toggleAll}
          className="text-cyan-300 hover:text-cyan-200"
          title={hidden.size === 0 ? "모두 해제" : "모두 선택"}
        >
          {hidden.size === 0 ? "모두 해제" : "모두 선택"}
        </button>
      </div>
      <div className="px-2 py-1.5 border-b border-purple-500/20">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${stackLabel} 검색`}
            className="w-full pl-6 pr-2 py-1 text-xs rounded border border-purple-500/20 bg-slate-900 text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>
      <div className="px-2 py-1 border-b border-purple-500/10 flex items-center gap-2 text-[10px] text-gray-500 uppercase tracking-wide">
        <span className="w-3 shrink-0" />
        <span className="w-3 shrink-0" />
        <span className="flex-1">{stackLabel}</span>
        <SortHeaderBtn label="Cost" width="w-12" activeKey={sortKey} dir={sortDir} myKey="cost" onClick={() => handleSortClick("cost")} />
        <SortHeaderBtn label="Sales" width="w-12" activeKey={sortKey} dir={sortDir} myKey="sales" onClick={() => handleSortClick("sales")} />
        <SortHeaderBtn label="ROAS" width="w-10" activeKey={sortKey} dir={sortDir} myKey="roas" onClick={() => handleSortClick("roas")} />
        <span className="w-10 text-right shrink-0">비중</span>
        {onDrill && (
          <span className="w-12 text-center shrink-0 text-gray-400 tracking-wider">
            드릴
          </span>
        )}
      </div>
      <div className="overflow-auto flex-1 min-h-0 text-xs">
        {filtered.map((t) => {
          const isHidden = hidden.has(t.value);
          const share =
            totalSales > 0 && Number.isFinite(t.sales)
              ? (t.sales / totalSales) * 100
              : null;
          return (
            <label
              key={t.value}
              className={`flex items-center gap-2 px-2 py-1 hover:bg-white/5 cursor-pointer ${
                isHidden ? "opacity-50" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={!isHidden}
                onChange={() => toggleTerm(t.value)}
                className="accent-cyan-500 shrink-0"
              />
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded shrink-0"
                style={{ backgroundColor: colorByValue.get(t.value) ?? COLORS[0] }}
              />
              <span
                className="flex-1 min-w-0 truncate text-gray-200 cursor-context-menu"
                title={`${t.value}\n우클릭: 복사`}
                onContextMenu={(e) => copyValue(e, t.value)}
              >
                <AsinLinkified text={t.value} />
              </span>
              {copiedValue === t.value && (
                <span className="text-[10px] text-emerald-300 shrink-0 animate-pulse">
                  복사됨
                </span>
              )}
              <span className="w-12 tabular-nums text-gray-400 text-right shrink-0">
                {fmtShort(t.cost)}
              </span>
              <span className="w-12 tabular-nums text-gray-400 text-right shrink-0">
                {fmtShort(t.sales)}
              </span>
              <span
                className={`w-10 tabular-nums text-right shrink-0 ${
                  t.roas == null
                    ? "text-gray-500"
                    : t.roas >= 1
                      ? "text-emerald-300"
                      : "text-rose-300"
                }`}
              >
                {t.roas != null ? t.roas.toFixed(2) : "—"}
              </span>
              <span className="w-10 tabular-nums text-cyan-300/80 text-right shrink-0">
                {share != null ? fmtPct(share) : "—"}
              </span>
              {onDrill && (
                <span className="w-12 flex justify-center shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      // Don't toggle the checkbox when clicking the drill button
                      e.preventDefault();
                      e.stopPropagation();
                      onDrill(t.value);
                    }}
                    className="p-1 rounded text-gray-500 hover:text-cyan-300 hover:bg-white/5"
                    title={`이 ${stackLabel} 에 매칭된 항목 드릴다운`}
                  >
                    <Crosshair size={12} />
                  </button>
                </span>
              )}
            </label>
          );
        })}
        {terms.length === 0 && <div className="p-3 text-center text-gray-500">—</div>}
        {terms.length > 0 && filtered.length === 0 && (
          <div className="p-3 text-center text-gray-500">일치하는 값이 없습니다</div>
        )}
      </div>
    </div>
  );
}

/** Clickable right-aligned sort header for numeric columns. */
export function SortHeaderBtn({
  label,
  width,
  activeKey,
  dir,
  myKey,
  onClick,
}: {
  label: string;
  width: string;
  activeKey: SortKey;
  dir: SortDir;
  myKey: Exclude<SortKey, null>;
  onClick: () => void;
}) {
  const active = activeKey === myKey;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${width} shrink-0 inline-flex items-center justify-end gap-0.5 text-right uppercase tracking-wide ${
        active ? "text-cyan-300" : "text-gray-500 hover:text-gray-300"
      }`}
      title={`${label} 기준 정렬`}
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
  );
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 10) return n.toFixed(0) + "%";
  if (n >= 1) return n.toFixed(1) + "%";
  if (n >= 0.1) return n.toFixed(1) + "%";
  return "<0.1%";
}

function fmtTotal(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return "$" + Math.round(n).toLocaleString();
  return "$" + n.toFixed(2);
}

function fmtAvgMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + Math.round(n).toLocaleString();
}

function fmtShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

/** First day of the calendar month containing the given ISO date. */
function monthBucketStart(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-01`;
}

/** "1월" or (when data spans years) "2026.01". */
function monthLabel(bucketStart: string, multiYear: boolean): string {
  const m = /^(\d{4})-(\d{2})/.exec(bucketStart);
  if (!m) return bucketStart;
  if (multiYear) return `${m[1]}.${m[2]}`;
  return `${Number(m[2])}월`;
}

function fmtAxis(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}
