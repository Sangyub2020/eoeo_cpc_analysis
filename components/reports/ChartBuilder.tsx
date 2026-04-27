"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ResponsiveContainer,
} from "recharts";
import { Loader2, Search, ArrowUp, ArrowDown, ArrowUpDown, FileText, X } from "lucide-react";
import AsinLinkified from "@/components/reports/AsinLinkified";
import { createPortal } from "react-dom";
import type { ReportColumn } from "@/lib/reports/types";
import type { FilterState } from "@/lib/reports/filter";
import { fmtShortDate } from "@/lib/reports/format";
import DimensionFilter from "@/components/reports/DimensionFilter";
import { cn } from "@/lib/utils";

type ChartKind = "bar" | "line" | "area" | "pie";
type AggFn = "sum" | "avg" | "min" | "max" | "count";
type Axis = "left" | "right";
const CHART_KINDS: ChartKind[] = ["bar", "line", "area", "pie"];
const AGG_FNS: AggFn[] = ["sum", "avg", "min", "max", "count"];

const COLORS = [
  "#22d3ee", "#a855f7", "#10b981", "#f59e0b", "#f43f5e",
  "#38bdf8", "#84cc16", "#e879f9", "#fb7185", "#fbbf24",
];

interface Props {
  slug: string;
  columns: ReportColumn[];
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  initialConfig?: Partial<ChartConfigSnapshot>;
  onConfigChange?: (c: ChartConfigSnapshot) => void;
  /** Map of `campaign_name → nickname`. Only applied when groupCol is
   *  `campaign_name`: chart title shows "name (nickname) 외 N", right panel
   *  shows just the nickname. When no mapping, falls back to raw names. */
  nicknames?: Record<string, string>;
  /** Brand context — passed through to the right-panel so the per-campaign
   *  history (수정일지) popup can fetch entries for this brand only. */
  brand?: string;
}

export interface ChartConfigSnapshot {
  kind: ChartKind;
  xCol: string;
  yCols: { col: string; fn: AggFn; axis: Axis; enabled?: boolean }[];
  groupCol: string;
  showWeeklyAvg?: boolean;
}

type YCol = { col: string; fn: AggFn; axis: Axis; enabled: boolean };

interface AggregateResponse {
  xColumn: string;
  groupColumn: string | null;
  metricColumns: { col: string; fn: AggFn; alias: string }[];
  rows: { x: string; g?: string; [key: string]: unknown }[];
  totals?: { col: string; fn: AggFn; total: number | null }[];
}

interface BucketInfo {
  firstDate: string;
  lastDate: string;
  label: string; // e.g. "1월" or "2025.12"
  /** Sum of primary metric over this bucket / number of distinct days with data */
  primaryAvg: number;
  /** Number of distinct days with data in this bucket */
  days: number;
  primaryLabel: string;
  /** sum(sales) / sum(total_cost) for the bucket, only when both are active Y metrics (fn=sum) */
  roas: number | null;
}

export default function ChartBuilder({ slug, columns, filter, setFilter, initialConfig, onConfigChange, nicknames, brand }: Props) {
  const numericCols = columns.filter(
    (c) => c.data_type === "numeric" || c.data_type === "integer",
  );
  const firstDate = columns.find(
    (c) => c.data_type === "date" || c.data_type === "timestamp",
  );
  /** Columns eligible as a grouping dimension. Restricted to the three
   *  meaningful pivot axes (campaign / search term / target value) so the
   *  unit toggle stays focused — match-type / currency / etc. just clutter. */
  const ALLOWED_GROUP_DIMS = new Set<string>([
    "campaign_name",
    "search_term",
    "target_value",
  ]);
  const groupableCols = columns.filter(
    (c) => c.data_type === "text" && ALLOWED_GROUP_DIMS.has(c.column_name),
  );

  const [kind, setKind] = useState<ChartKind>(initialConfig?.kind ?? "line");
  const [xCol, setXCol] = useState<string>(
    initialConfig?.xCol ?? firstDate?.column_name ?? columns[0]?.column_name ?? "",
  );
  const [yCols, setYCols] = useState<YCol[]>(() => {
    if (initialConfig?.yCols) {
      return initialConfig.yCols.map((y) => ({ enabled: true, ...y }));
    }
    // Preferred defaults for Amazon ad reports: Sales + Total cost (if both exist)
    const preferred: YCol[] = [];
    const sales = columns.find((c) => c.column_name === "sales");
    const cost = columns.find((c) => c.column_name === "total_cost");
    if (sales) preferred.push({ col: "sales", fn: "sum", axis: "left", enabled: true });
    if (cost) preferred.push({ col: "total_cost", fn: "sum", axis: "left", enabled: true });
    if (preferred.length > 0) return preferred;
    // Fallback for arbitrary report shapes
    return numericCols.slice(0, 2).map((c) => ({
      col: c.column_name,
      fn: "sum" as AggFn,
      axis: "left" as Axis,
      enabled: true,
    }));
  });
  const activeYCols = yCols.filter((y) => y.enabled);
  // Default to the first text column so the chart always groups by *some* dimension.
  // If an initial config points at a now-missing column, fall back to the first text col.
  const [groupCol, setGroupCol] = useState<string>(() => {
    const wanted = initialConfig?.groupCol;
    if (wanted && groupableCols.some((c) => c.column_name === wanted)) return wanted;
    return groupableCols[0]?.column_name ?? "";
  });
  const [showWeeklyAvg, setShowWeeklyAvg] = useState<boolean>(initialConfig?.showWeeklyAvg ?? true);
  const [logScale, setLogScale] = useState<boolean>(false);
  const [autoFilling, setAutoFilling] = useState(false);

  // Per-group stats for the right-side panel (e.g. campaign name + cost + sales + ROAS).
  const [termStats, setTermStats] = useState<
    { value: string; cost: number; sales: number; roas: number | null }[]
  >([]);

  useEffect(() => {
    onConfigChange?.({ kind, xCol, yCols, groupCol, showWeeklyAvg });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, xCol, yCols, groupCol, showWeeklyAvg]);

  // Fetch per-group stats (Cost + Sales, ordered by cost desc). Runs when the group
  // column or the filter (excluding this column) changes.
  // Also auto-selects the top-1 term when filter.dimensions[groupCol] is empty.
  const filterWithoutGroupKey = useMemo(() => {
    const dims = { ...(filter.dimensions ?? {}) };
    if (groupCol) delete dims[groupCol];
    return JSON.stringify({
      dateColumn: filter.dateColumn,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      dimensions: dims,
    });
  }, [filter, groupCol]);

  useEffect(() => {
    if (!groupCol) {
      setTermStats([]);
      return;
    }
    const costMetricExists = columns.some((c) => c.column_name === "total_cost");
    const salesExists = columns.some((c) => c.column_name === "sales");
    if (!costMetricExists) {
      setTermStats([]);
      return;
    }
    const abort = new AbortController();
    setAutoFilling(true);
    // Strip this column's own selection so the panel lists ALL values matching the other filters.
    const dims = { ...(filter.dimensions ?? {}) };
    delete dims[groupCol];
    const baseFilter = { ...filter, dimensions: dims };

    fetch(`/api/reports/${slug}/distinct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        column: groupCol,
        filter: baseFilter,
        limit: 1000,
        metric: { col: "total_cost", fn: "sum" },
        extraMetrics: salesExists ? [{ col: "sales", fn: "sum" }] : [],
      }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        const stats = (
          (j.values ?? []) as {
            value: string | null;
            metric?: number;
            e0?: number;
          }[]
        )
          .filter((v): v is { value: string; metric?: number; e0?: number } => v.value != null)
          .map((v) => {
            const cost = Number(v.metric ?? 0);
            const sales = Number(v.e0 ?? 0);
            return {
              value: v.value,
              cost: Number.isFinite(cost) ? cost : 0,
              sales: Number.isFinite(sales) ? sales : 0,
              roas: cost > 0 ? sales / cost : null,
            };
          });
        setTermStats(stats);

        // Auto-select top 1 when nothing picked yet
        const current = filter.dimensions?.[groupCol] ?? [];
        if (current.length === 0 && stats.length > 0) {
          setFilter({
            ...filter,
            dimensions: { ...(filter.dimensions ?? {}), [groupCol]: [stats[0].value] },
          });
        }
      })
      .catch(() => {})
      .finally(() => setAutoFilling(false));
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, groupCol, filterWithoutGroupKey]);

  const [data, setData] = useState<AggregateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refetch on any config/filter change
  useEffect(() => {
    if (!xCol || activeYCols.length === 0) {
      setData(null);
      return;
    }
    // If group column is set but no values picked in filter bar yet, the auto-fill effect
    // will populate filter.dimensions[groupCol] — wait for it to avoid a spaghetti chart.
    if (groupCol && (filter.dimensions?.[groupCol] ?? []).length === 0) {
      setData(null);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/reports/${slug}/aggregate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filter,
        xColumn: xCol,
        groupColumn: groupCol || null,
        metrics: activeYCols.map(({ col, fn }) => ({ col, fn })),
        limit: 10000,
      }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setData(j as AggregateResponse);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "집계 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, filter, xCol, yCols, groupCol]);

  // Pivot server rows into chart-ready shape
  const { chartRows, seriesKeys, seriesAxis, metricTotals } = useMemo(() => {
    const empty = {
      chartRows: [] as Record<string, unknown>[],
      seriesKeys: [] as string[],
      seriesAxis: new Map<string, Axis>(),
      metricTotals: [] as { label: string; fn: AggFn; total: number }[],
    };
    if (!data?.rows?.length) return empty;
    const colMap = new Map(columns.map((c) => [c.column_name, c]));
    const yLabels = data.metricColumns.map((m) => {
      const c = colMap.get(m.col);
      const base = c?.source_header ?? m.col;
      return m.fn === "sum" ? base : `${base}(${m.fn})`;
    });
    // Use server-provided totals (computed on the raw filtered dataset) so "합계" is always accurate.
    const metricTotals = data.metricColumns.map((m, i) => {
      const serverTotal = data.totals?.find((t) => t.col === m.col && t.fn === m.fn);
      return { label: yLabels[i], fn: m.fn, total: serverTotal?.total ?? 0 };
    });
    // Axis lookup by (col, fn) — server-returned metricColumns may not be 1:1 with yCols state order
    const axisByKey = new Map<string, Axis>(
      yCols.map((y) => [`${y.col}|${y.fn}`, y.axis]),
    );
    const axisFor = (m: { col: string; fn: AggFn }): Axis =>
      axisByKey.get(`${m.col}|${m.fn}`) ?? "left";

    const seriesAxis = new Map<string, Axis>();

    if (data.groupColumn) {
      // One row per (x, g). Pivot so each g becomes a series per y metric.
      const byX = new Map<string, Record<string, unknown>>();
      for (const r of data.rows) {
        const xk = String(r.x);
        let out = byX.get(xk);
        if (!out) {
          out = { x: r.x };
          byX.set(xk, out);
        }
        const g = r.g ?? "(null)";
        data.metricColumns.forEach((m, i) => {
          const seriesName = yLabels.length > 1 ? `${g} · ${yLabels[i]}` : String(g);
          out![seriesName] = r[m.alias] == null ? null : Number(r[m.alias]);
          seriesAxis.set(seriesName, axisFor(m));
        });
      }
      const chartRows = Array.from(byX.values()).sort((a, b) =>
        String(a.x) < String(b.x) ? -1 : 1,
      );
      const keys = new Set<string>();
      for (const row of chartRows) {
        for (const k of Object.keys(row)) if (k !== "x") keys.add(k);
      }
      return { chartRows, seriesKeys: Array.from(keys), seriesAxis, metricTotals };
    }

    // No group: each metric is a series, keyed by yLabel
    const chartRows = data.rows.map((r) => {
      const out: Record<string, unknown> = { x: r.x };
      data.metricColumns.forEach((m, i) => {
        out[yLabels[i]] = r[m.alias] == null ? null : Number(r[m.alias]);
      });
      return out;
    });
    data.metricColumns.forEach((m, i) => {
      seriesAxis.set(yLabels[i], axisFor(m));
    });
    return { chartRows, seriesKeys: yLabels, seriesAxis, metricTotals };
  }, [data, columns, yCols]);

  // Monthly stats for the overlay labels (independent of pivoted chartRows — computed
  // off the raw server response so it works consistently in both "no group" and "group" modes).
  const monthlyBuckets: BucketInfo[] = useMemo(() => {
    if (!showWeeklyAvg) return [];
    if (!data?.rows?.length) return [];

    const colMap = new Map(columns.map((c) => [c.column_name, c]));
    const yLabelOf = (m: { col: string; fn: AggFn }) => {
      const c = colMap.get(m.col);
      const base = c?.source_header ?? m.col;
      return m.fn === "sum" ? base : `${base}(${m.fn})`;
    };
    const primaryMetric = data.metricColumns[0];
    if (!primaryMetric) return [];
    const primaryLabel = yLabelOf(primaryMetric);

    // ROAS needs BOTH sales and total_cost to be active Y metrics with fn=sum
    // (server-side sums per group/day -> we can still recover month totals by summing rows).
    const salesMetric = data.metricColumns.find(
      (m) => m.col === "sales" && m.fn === "sum",
    );
    const costMetric = data.metricColumns.find(
      (m) => m.col === "total_cost" && m.fn === "sum",
    );
    const roasEnabled = !!salesMetric && !!costMetric;

    const byMonth = new Map<
      string,
      { dates: Set<string>; sum: number; salesSum: number; costSum: number }
    >();
    for (const r of data.rows) {
      const xStr = String(r.x);
      const bucket = monthBucketStart(xStr);
      let w = byMonth.get(bucket);
      if (!w) {
        w = { dates: new Set(), sum: 0, salesSum: 0, costSum: 0 };
        byMonth.set(bucket, w);
      }
      w.dates.add(xStr);
      const v = Number(r[primaryMetric.alias]);
      if (Number.isFinite(v)) w.sum += v;
      if (roasEnabled) {
        const s = Number(r[salesMetric!.alias]);
        const c = Number(r[costMetric!.alias]);
        if (Number.isFinite(s)) w.salesSum += s;
        if (Number.isFinite(c)) w.costSum += c;
      }
    }

    const sortedBuckets = Array.from(byMonth.keys()).sort();
    // Only prefix year when the data spans multiple years (keeps labels short in the common case).
    const years = new Set(sortedBuckets.map((s) => s.slice(0, 4)));
    const multiYear = years.size > 1;

    return sortedBuckets.map((bucketStart) => {
      const b = byMonth.get(bucketStart)!;
      const dates = Array.from(b.dates).sort();
      const days = b.dates.size;
      const roas =
        roasEnabled && b.costSum > 0 && Number.isFinite(b.salesSum / b.costSum)
          ? b.salesSum / b.costSum
          : null;
      return {
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        label: monthLabel(bucketStart, multiYear),
        primaryAvg: days > 0 ? b.sum / days : 0,
        days,
        primaryLabel,
        roas,
      };
    });
  }, [data, showWeeklyAvg, columns]);

  function addYCol() {
    const available = numericCols.find((c) => !yCols.some((y) => y.col === c.column_name));
    if (available)
      setYCols([...yCols, { col: available.column_name, fn: "sum", axis: "left", enabled: true }]);
  }
  function removeYCol(idx: number) {
    setYCols(yCols.filter((_, i) => i !== idx));
  }
  function updateYCol(
    idx: number,
    patch: Partial<{ col: string; fn: AggFn; axis: Axis; enabled: boolean }>,
  ) {
    setYCols(yCols.map((y, i) => (i === idx ? { ...y, ...patch } : y)));
  }

  const xLabel = columns.find((c) => c.column_name === xCol)?.source_header ?? xCol;

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl shadow-lg shadow-purple-500/10 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="차트 종류">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ChartKind)}
              className="w-full rounded-lg border border-purple-500/30 bg-slate-800 text-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
            >
              {CHART_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="X 축">
            <select
              value={xCol}
              onChange={(e) => setXCol(e.target.value)}
              className="w-full rounded-lg border border-purple-500/30 bg-slate-800 text-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
            >
              {columns.map((c) => (
                <option key={c.column_name} value={c.column_name}>
                  {c.source_header}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1.5 text-gray-300">
            <input
              type="checkbox"
              checked={logScale}
              onChange={(e) => setLogScale(e.target.checked)}
              className="accent-cyan-500"
            />
            <span>Y축 로그 스케일 (값 차이가 큰 시리즈 가시화)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 text-gray-300">
            <input
              type="checkbox"
              checked={showWeeklyAvg}
              onChange={(e) => setShowWeeklyAvg(e.target.checked)}
              className="accent-cyan-500"
            />
            <span>월별 일평균 오버레이</span>
          </label>
          <span className="text-gray-500">
            시리즈 {chartRows.length ? seriesKeys.length : 0}개 · 데이터 포인트 {chartRows.length}개
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-medium text-gray-400">Y 축 (숫자)</div>
            <div className="text-[10px] text-gray-500">L = 왼쪽 축 · R = 오른쪽 축 (스케일이 다른 지표는 R 로)</div>
          </div>
          {yCols.map((y, i) => (
            <div key={i} className={`flex items-center gap-2 ${y.enabled ? "" : "opacity-50"}`}>
              <input
                type="checkbox"
                checked={y.enabled}
                onChange={(e) => updateYCol(i, { enabled: e.target.checked })}
                title={y.enabled ? "차트에서 제외" : "차트에 포함"}
                className="shrink-0 accent-cyan-500"
              />
              <select
                value={y.col}
                onChange={(e) => updateYCol(i, { col: e.target.value })}
                className="flex-1 rounded-lg border border-purple-500/30 bg-slate-800 text-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
              >
                {numericCols.map((c) => (
                  <option key={c.column_name} value={c.column_name}>
                    {c.source_header}
                  </option>
                ))}
              </select>
              <select
                value={y.fn}
                onChange={(e) => updateYCol(i, { fn: e.target.value as AggFn })}
                className="w-28 rounded-lg border border-purple-500/30 bg-slate-800 text-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
              >
                {AGG_FNS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <div className="inline-flex rounded-lg border border-purple-500/30 overflow-hidden text-xs">
                {(["left", "right"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => updateYCol(i, { axis: a })}
                    title={a === "left" ? "왼쪽 Y 축" : "오른쪽 Y 축"}
                    className={`px-2.5 py-2 transition-colors ${
                      y.axis === a
                        ? "bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-cyan-200"
                        : "bg-slate-800 text-gray-500 hover:text-cyan-300"
                    }`}
                  >
                    {a === "left" ? "L" : "R"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => removeYCol(i)}
                className="px-2 py-1 text-sm text-gray-400 hover:text-rose-300"
                title="이 행 삭제"
              >
                삭제
              </button>
            </div>
          ))}
          {numericCols.length > yCols.length && (
            <button
              onClick={addYCol}
              className="text-sm px-3 py-1.5 rounded-md border border-cyan-500/30 bg-black/40 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              + Y 축 추가
            </button>
          )}
        </div>
      </div>

      <div className="p-4 rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl shadow-lg shadow-purple-500/10 text-gray-300 lg:-mr-[100px]">
        {/* Selected-values title — shows what's currently being plotted as series */}
        {groupCol && (() => {
          const selected = filter.dimensions?.[groupCol] ?? [];
          const groupLabel =
            columns.find((c) => c.column_name === groupCol)?.source_header ?? groupCol;
          if (selected.length === 0) {
            return (
              <div className="mb-3 text-sm text-gray-500">
                <span className="text-gray-500">선택된 {groupLabel}이 없습니다.</span>
              </div>
            );
          }
          const first = selected[0];
          const extra = selected.length - 1;
          // Nicknames only apply when grouping by campaign_name.
          const useNicknames = groupCol === "campaign_name" && !!nicknames;
          const firstNickname = useNicknames ? nicknames?.[first] : undefined;
          return (
            <div className="mb-3 flex items-baseline flex-wrap gap-x-2 gap-y-1">
              <span className="text-xs text-gray-500 uppercase tracking-wide shrink-0">
                {groupLabel}
              </span>
              <span
                className="text-base font-semibold text-gray-100 truncate max-w-[720px]"
                title={first}
              >
                <AsinLinkified text={first} />
              </span>
              {firstNickname && (
                <span
                  className="text-base font-semibold text-cyan-300"
                  title={`닉네임: ${firstNickname}`}
                >
                  ({firstNickname})
                </span>
              )}
              {extra > 0 && (
                <span
                  className="text-sm text-cyan-300 font-medium"
                  title={selected.slice(1).join("\n")}
                >
                  외 {extra}개
                </span>
              )}
            </div>
          );
        })()}

        {/* Chart header: mode toggle (group basis) + inline dimension filters for each groupable col */}
        {groupableCols.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-purple-500/30 overflow-hidden text-sm">
              {groupableCols.map((c) => {
                const active = groupCol === c.column_name;
                return (
                  <button
                    key={c.column_name}
                    type="button"
                    onClick={() => {
                      if (active) return;
                      // Reset all groupable filters so the new mode gets top-5 auto-fill
                      // and the other dimension falls back to "전체" (empty).
                      const next = { ...(filter.dimensions ?? {}) };
                      for (const gc of groupableCols) delete next[gc.column_name];
                      setFilter({ ...filter, dimensions: next });
                      setGroupCol(c.column_name);
                    }}
                    className={cn(
                      "px-3 py-1.5 transition-colors whitespace-nowrap",
                      active
                        ? "bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-cyan-200 font-medium"
                        : "bg-slate-800 text-gray-400 hover:text-cyan-300",
                    )}
                    title={`${c.source_header} 을(를) 시리즈 기준으로 사용`}
                  >
                    {c.source_header} 단위
                  </button>
                );
              })}
            </div>

            <div className="h-6 w-px bg-purple-500/20" />

            {groupableCols.map((c) => {
              const primaryY = activeYCols[0];
              const primaryYLabel = primaryY
                ? columns.find((col) => col.column_name === primaryY.col)?.source_header
                : undefined;
              return (
                <DimensionFilter
                  key={c.column_name}
                  slug={slug}
                  column={c.column_name}
                  label={c.source_header}
                  filter={filter}
                  selected={filter.dimensions?.[c.column_name] ?? []}
                  metric={
                    primaryY
                      ? { col: primaryY.col, fn: primaryY.fn, label: primaryYLabel }
                      : undefined
                  }
                  onChange={(vals) => {
                    const next = { ...(filter.dimensions ?? {}) };
                    if (vals.length === 0) delete next[c.column_name];
                    else next[c.column_name] = vals;
                    setFilter({ ...filter, dimensions: next });
                  }}
                />
              );
            })}

            {autoFilling && (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                <Loader2 size={10} className="animate-spin text-cyan-400" />
                기본 선택 불러오는 중
              </span>
            )}
          </div>
        )}

        {metricTotals.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-gray-500">기간 누적:</span>
            {metricTotals.map((m) => (
              <div key={m.label} className="inline-flex items-baseline gap-1.5">
                <span className="text-gray-400">{m.label}:</span>
                <span className="text-cyan-300 font-semibold tabular-nums">
                  {fmtTotal(m.total)}
                </span>
                {m.fn !== "sum" && (
                  <span className="text-[10px] text-gray-500">(일/그룹 {m.fn} 누적)</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 items-stretch">
          <div className="flex-1 h-[420px] relative min-w-0">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm z-10 rounded-md">
                <Loader2 className="animate-spin text-cyan-400" size={20} />
              </div>
            )}
            {error ? (
              <div className="h-full flex items-center justify-center text-sm text-rose-400">
                {error}
              </div>
            ) : chartRows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                데이터가 없거나 X/Y 선택이 비어있습니다.
              </div>
            ) : kind === "pie" && !seriesKeys[0] ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                Pie 는 Y 축 1개가 필요합니다.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {renderChart(kind, chartRows, xLabel, seriesKeys, seriesAxis, logScale, monthlyBuckets)}
              </ResponsiveContainer>
            )}
          </div>

          {groupCol && (
            <GroupPanel
              stackLabel={
                columns.find((c) => c.column_name === groupCol)?.source_header ?? groupCol
              }
              stats={termStats}
              loading={autoFilling}
              selected={filter.dimensions?.[groupCol] ?? []}
              onChange={(vals) => {
                const next = { ...(filter.dimensions ?? {}) };
                if (vals.length === 0) delete next[groupCol];
                else next[groupCol] = vals;
                setFilter({ ...filter, dimensions: next });
              }}
              nicknames={groupCol === "campaign_name" ? nicknames : undefined}
              brand={brand}
              showHistoryIcon={groupCol === "campaign_name"}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type SortKey = "cost" | "sales" | "roas" | null;
type SortDir = "asc" | "desc";

function GroupPanel({
  stackLabel,
  stats,
  loading,
  selected,
  onChange,
  nicknames,
  brand,
  showHistoryIcon,
}: {
  stackLabel: string;
  stats: { value: string; cost: number; sales: number; roas: number | null }[];
  /** True while the distinct fetch is in flight. Renders a loading hint
   *  so the user sees the panel structure immediately instead of an
   *  empty viewport. */
  loading?: boolean;
  selected: string[];
  onChange: (v: string[]) => void;
  /** Present only when grouping by campaign_name — if a row has a nickname,
   *  we show the nickname in place of the raw campaign_name. */
  nicknames?: Record<string, string>;
  /** Brand context for the per-campaign history (수정일지) popup. */
  brand?: string;
  /** Show the history popup icon next to each row (only meaningful when
   *  grouping by campaign_name). */
  showHistoryIcon?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [historyCampaign, setHistoryCampaign] = useState<string | null>(null);
  /** Set of campaign_names that have at least one history entry. Loaded
   *  once when the panel mounts under a campaign_name groupCol so we can
   *  show the icon only on campaigns that actually have edits. */
  const [campaignsWithHistory, setCampaignsWithHistory] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (!showHistoryIcon || !brand) return;
    const abort = new AbortController();
    fetch(`/api/brands/${encodeURIComponent(brand)}/history`, {
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        const set = new Set<string>();
        for (const e of (j.entries ?? []) as { campaign_name?: string | null }[]) {
          if (e.campaign_name) set.add(e.campaign_name);
        }
        setCampaignsWithHistory(set);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [brand, showHistoryIcon]);

  const selectedSet = new Set(selected);
  function toggle(v: string) {
    if (selectedSet.has(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  }
  function toggleAll() {
    if (selected.length === stats.length) onChange([]);
    else onChange(stats.map((s) => s.value));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? stats.filter(
          (s) =>
            s.value.toLowerCase().includes(q) ||
            (nicknames?.[s.value] ?? "").toLowerCase().includes(q),
        )
      : stats;
    if (!sortKey) return base;
    const pick = (s: (typeof stats)[number]): number | null =>
      sortKey === "cost" ? s.cost : sortKey === "sales" ? s.sales : s.roas;
    const mul = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * mul;
    });
  }, [stats, search, sortKey, sortDir, nicknames]);

  function handleSortClick(k: Exclude<SortKey, null>) {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  return (
    <div className="w-[460px] shrink-0 border border-purple-500/20 rounded-md bg-slate-900/60 flex flex-col">
      <div className="px-3 py-2 border-b border-purple-500/20 flex items-center justify-between text-xs">
        <span className="text-gray-400">
          {stackLabel}{" "}
          <span className="text-gray-500">
            ({selected.length}/{stats.length})
          </span>
        </span>
        <button
          onClick={toggleAll}
          className="text-cyan-300 hover:text-cyan-200"
        >
          {selected.length === stats.length ? "모두 해제" : "모두 선택"}
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
        <span className="flex-1">Name</span>
        <SortHeaderBtn label="Cost" width="w-14" activeKey={sortKey} dir={sortDir} myKey="cost" onClick={() => handleSortClick("cost")} />
        <SortHeaderBtn label="Sales" width="w-14" activeKey={sortKey} dir={sortDir} myKey="sales" onClick={() => handleSortClick("sales")} />
        <SortHeaderBtn label="ROAS" width="w-12" activeKey={sortKey} dir={sortDir} myKey="roas" onClick={() => handleSortClick("roas")} />
        <span className="w-10 text-right shrink-0">비중</span>
        {showHistoryIcon && (
          <span className="w-6 text-center shrink-0 normal-case">일지</span>
        )}
      </div>
      <div className="overflow-auto max-h-[420px] text-xs">
        {(() => {
          const totalSales = stats.reduce(
            (sum, s) => sum + (Number.isFinite(s.sales) ? s.sales : 0),
            0,
          );
          return filtered.map((s) => {
            const checked = selectedSet.has(s.value);
            const share =
              totalSales > 0 && Number.isFinite(s.sales)
                ? (s.sales / totalSales) * 100
                : null;
            return (
              <label
                key={s.value}
                className={`flex items-center gap-2 px-2 py-1 hover:bg-white/5 cursor-pointer ${
                  checked ? "" : "opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s.value)}
                  className="accent-cyan-500 shrink-0"
                />
                <span
                  className="flex-1 truncate text-gray-200"
                  title={nicknames?.[s.value] ? `${nicknames[s.value]} — ${s.value}` : s.value}
                >
                  <AsinLinkified text={nicknames?.[s.value] ?? s.value} />
                </span>
                <span className="w-14 tabular-nums text-gray-400 text-right shrink-0">
                  {fmtMoneyShort(s.cost)}
                </span>
                <span className="w-14 tabular-nums text-gray-400 text-right shrink-0">
                  {fmtMoneyShort(s.sales)}
                </span>
                <span
                  className={`w-12 tabular-nums text-right shrink-0 ${
                    s.roas == null
                      ? "text-gray-500"
                      : s.roas >= 1
                        ? "text-emerald-300"
                        : "text-rose-300"
                  }`}
                >
                  {s.roas != null ? s.roas.toFixed(2) : "—"}
                </span>
                <span className="w-10 tabular-nums text-cyan-300/80 text-right shrink-0">
                  {share != null ? fmtPctShort(share) : "—"}
                </span>
                {showHistoryIcon && (
                  <span className="w-6 flex justify-center shrink-0">
                    {campaignsWithHistory.has(s.value) ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setHistoryCampaign(s.value);
                        }}
                        className="p-0.5 rounded text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
                        title="수정일지 열기"
                      >
                        <FileText size={12} />
                      </button>
                    ) : null}
                  </span>
                )}
              </label>
            );
          });
        })()}
        {loading && stats.length === 0 && (
          <div className="p-6 text-center text-gray-500 text-xs inline-flex items-center justify-center gap-2 w-full">
            <Loader2 size={12} className="animate-spin text-cyan-400" />
            패널 데이터 불러오는 중...
          </div>
        )}
        {!loading && stats.length === 0 && (
          <div className="p-6 text-center text-gray-500 text-xs">
            표시할 값이 없습니다
          </div>
        )}
        {stats.length > 0 && filtered.length === 0 && (
          <div className="p-3 text-center text-gray-500">일치하는 값이 없습니다</div>
        )}
      </div>
      {historyCampaign && brand && (
        <CampaignHistoryPopup
          brand={brand}
          campaign={historyCampaign}
          nickname={nicknames?.[historyCampaign]}
          onClose={() => setHistoryCampaign(null)}
        />
      )}
    </div>
  );
}

function SortHeaderBtn({
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

function fmtPctShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 10) return n.toFixed(0) + "%";
  if (n >= 1) return n.toFixed(1) + "%";
  if (n >= 0.1) return n.toFixed(1) + "%";
  return "<0.1%";
}

function fmtMoneyShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

interface HistoryEntry {
  id: string;
  campaign_name: string | null;
  entry_date: string;
  note: string;
  screenshots: string[];
}

/** Read-only popup that lists 수정일지 entries for a single campaign under
 *  a brand. Shown when the user clicks the file-text icon in the right
 *  panel of the campaign chart. */
function CampaignHistoryPopup({
  brand,
  campaign,
  nickname,
  onClose,
}: {
  brand: string;
  campaign: string;
  nickname?: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    fetch(`/api/brands/${encodeURIComponent(brand)}/history`, {
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        const all = (j.entries ?? []) as HistoryEntry[];
        const mine = all.filter((e) => e.campaign_name === campaign);
        mine.sort((a, b) =>
          a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0,
        );
        setEntries(mine);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "로드 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [brand, campaign]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => {
      document.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-lg border border-purple-500/30 bg-slate-900 shadow-2xl shadow-cyan-500/10">
        <div className="px-5 py-3 border-b border-purple-500/20 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-500 uppercase tracking-wide">
              수정일지 — {brand}
            </div>
            <div className="text-base font-semibold text-gray-100 mt-0.5 truncate" title={campaign}>
              {nickname ? (
                <>
                  <span className="text-cyan-300">{nickname}</span>{" "}
                  <span className="text-gray-500 font-mono text-xs">{campaign}</span>
                </>
              ) : (
                <span className="font-mono">{campaign}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-rose-300 hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 flex-1 overflow-auto space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
              <Loader2 size={14} className="animate-spin text-cyan-400" /> 불러오는 중...
            </div>
          ) : error ? (
            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              이 캠페인의 수정일지 기록이 없습니다.
            </div>
          ) : (
            entries.map((e) => (
              <div
                key={e.id}
                className="p-3 rounded-md border border-purple-500/20 bg-slate-900/60 space-y-2"
              >
                <div className="text-xs text-cyan-300 font-mono">{e.entry_date}</div>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">
                  {e.note || <span className="italic text-gray-500">(내용 없음)</span>}
                </p>
                {e.screenshots && e.screenshots.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {e.screenshots.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={url}
                          alt=""
                          className="h-24 w-auto rounded-md border border-purple-500/20 object-cover hover:border-cyan-500/50 transition-colors"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs font-medium text-gray-400">{props.label}</span>
      {props.children}
    </label>
  );
}

function fmtTotal(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return Math.round(n).toLocaleString();
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

function fmtAvgMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + Math.round(n).toLocaleString();
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

function renderChart(
  kind: ChartKind,
  data: Record<string, unknown>[],
  xLabel: string,
  seriesKeys: string[],
  seriesAxis: Map<string, Axis>,
  logScale: boolean,
  buckets: BucketInfo[],
) {
  const bucketOverlay = buckets.map((b) => (
    <ReferenceArea
      key={b.firstDate}
      x1={b.firstDate}
      x2={b.lastDate}
      yAxisId="left"
      fill="rgba(168, 85, 247, 0.04)"
      stroke="rgba(168, 85, 247, 0.2)"
      strokeDasharray="2 3"
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
                {b.label} · 일평균 {fmtAvgMoney(b.primaryAvg)} ({b.days}일)
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
  ));
  const axisOf = (k: string): Axis => seriesAxis.get(k) ?? "left";
  const hasRight = seriesKeys.some((k) => axisOf(k) === "right");
  const yScale = logScale ? ("log" as const) : ("auto" as const);
  const yDomain: [number | string, number | string] = logScale
    ? ["auto", "auto"]
    : ["auto", "auto"];
  const AXIS_TICK = { fontSize: 10, fill: "#9ca3af" } as const;
  const AXIS_LABEL = { fontSize: 11, fill: "#9ca3af" } as const;
  const TOOLTIP_CONTENT_STYLE = {
    fontSize: 11,
    padding: "6px 8px",
    lineHeight: 1.4,
    backgroundColor: "#1e293b",
    border: "1px solid rgba(168, 85, 247, 0.3)",
    borderRadius: 8,
    color: "#e5e7eb",
  } as const;
  const TOOLTIP_ITEM_STYLE = { padding: 0, color: "#e5e7eb" } as const;
  const TOOLTIP_LABEL_STYLE = { fontSize: 11, fontWeight: 600, marginBottom: 2, color: "#22d3ee" } as const;
  const legendProps = {
    wrapperStyle: {
      maxHeight: 72,
      overflowY: "auto" as const,
      paddingTop: 6,
      fontSize: 10,
      lineHeight: 1.3,
    },
    iconSize: 10,
  };
  const xAxisProps = {
    tick: AXIS_TICK,
    tickFormatter: fmtShortDate,
    label: { value: xLabel, position: "insideBottom" as const, offset: -5, style: AXIS_LABEL },
  };
  const yAxisLeftProps = {
    tick: AXIS_TICK,
    scale: yScale,
    domain: yDomain,
    allowDataOverflow: true,
  };
  const yAxisRightProps = { ...yAxisLeftProps, orientation: "right" as const };
  const tooltipProps = {
    contentStyle: TOOLTIP_CONTENT_STYLE,
    itemStyle: TOOLTIP_ITEM_STYLE,
    labelStyle: TOOLTIP_LABEL_STYLE,
    labelFormatter: (v: unknown) => fmtShortDate(v),
  };
  switch (kind) {
    case "bar":
      return (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
          <XAxis dataKey="x" {...xAxisProps} />
          <YAxis yAxisId="left" {...yAxisLeftProps} />
          {hasRight && <YAxis yAxisId="right" {...yAxisRightProps} />}
          <Tooltip {...tooltipProps} />
          <Legend {...legendProps} />
          {bucketOverlay}
          {seriesKeys.map((k, i) => (
            <Bar key={k} dataKey={k} yAxisId={axisOf(k)} fill={COLORS[i % COLORS.length]} />
          ))}
        </BarChart>
      );
    case "line":
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
          <XAxis dataKey="x" {...xAxisProps} />
          <YAxis yAxisId="left" {...yAxisLeftProps} />
          {hasRight && <YAxis yAxisId="right" {...yAxisRightProps} />}
          <Tooltip {...tooltipProps} />
          <Legend {...legendProps} />
          {bucketOverlay}
          {seriesKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              yAxisId={axisOf(k)}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
          <XAxis dataKey="x" {...xAxisProps} />
          <YAxis yAxisId="left" {...yAxisLeftProps} />
          {hasRight && <YAxis yAxisId="right" {...yAxisRightProps} />}
          <Tooltip {...tooltipProps} />
          <Legend {...legendProps} />
          {bucketOverlay}
          {seriesKeys.map((k, i) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              yAxisId={axisOf(k)}
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.3}
              connectNulls
            />
          ))}
        </AreaChart>
      );
    case "pie": {
      const series = seriesKeys[0]!;
      return (
        <PieChart>
          <Tooltip {...tooltipProps} />
          <Legend {...legendProps} />
          <Pie
            data={data}
            dataKey={series}
            nameKey="x"
            cx="50%"
            cy="50%"
            outerRadius={140}
            label={{ fontSize: 10 }}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      );
    }
  }
}
