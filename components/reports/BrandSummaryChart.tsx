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
  Customized,
} from "recharts";
import { Loader2 } from "lucide-react";
import type { ReportColumn } from "@/lib/reports/types";
import type { ChartConfigSnapshot } from "@/components/reports/ChartBuilder";
import { fmtShortDate } from "@/lib/reports/format";
import { eventColors, type BrandEvent } from "@/lib/reports/brand-events";

type AggFn = "sum" | "avg" | "min" | "max" | "count";
type Axis = "left" | "right";
type ChartKind = "bar" | "line" | "area" | "pie";

interface Props {
  /** Slug of the report_type used to source brand-wide totals. The chart
   *  ignores per-dimension filters — only the date window is applied. */
  slug: string;
  columns: ReportColumn[];
  dateColumn: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  /** Mirrored from the campaign-level ChartBuilder above. The brand chart
   *  reuses kind / xCol / yCols / showWeeklyAvg / logScale so changes there
   *  are reflected here too. groupCol is intentionally ignored. */
  config: ChartConfigSnapshot | null;
  /** 브랜드 페이지에서 등록한 이벤트 — X 축이 date 컬럼일 때만 표시. */
  events?: BrandEvent[];
}

interface AggResp {
  rows: { x: string; [key: string]: unknown }[];
  metricColumns: { col: string; fn: AggFn; alias: string }[];
  totals?: { col: string; fn: AggFn; total: number | null }[];
}

interface BucketInfo {
  firstDate: string;
  lastDate: string;
  label: string;
  primaryAvg: number;
  primaryLabel: string;
  days: number;
  roas: number | null;
}

const COLORS = [
  "#22d3ee", "#a855f7", "#10b981", "#f59e0b", "#f43f5e",
  "#38bdf8", "#84cc16", "#e879f9", "#fb7185", "#fbbf24",
];
const ROAS_COLOR = "#fbbf24";

export default function BrandSummaryChart({
  slug,
  columns,
  dateColumn,
  dateFrom,
  dateTo,
  config,
  events,
}: Props) {
  const kind: ChartKind = config?.kind ?? "line";
  const xCol = config?.xCol ?? dateColumn ?? "";
  const showWeeklyAvg = config?.showWeeklyAvg ?? true;
  const logScale = config?.logScale ?? false;
  const activeYCols = useMemo(
    () => (config?.yCols ?? []).filter((y) => y.enabled !== false),
    [config?.yCols],
  );

  const [showRoas, setShowRoas] = useState(false);
  /** Series labels the user has hidden via the per-series toggles. New series
   *  default to visible (set is empty), so adding a Y axis in the controls
   *  panel above immediately shows up here. Stale entries are pruned when the
   *  series list changes (e.g. user removed a Y axis). */
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [data, setData] = useState<AggResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable JSON of metrics so the effect doesn't refire on identity changes.
  const metricsKey = useMemo(
    () => JSON.stringify(activeYCols.map((y) => ({ col: y.col, fn: y.fn }))),
    [activeYCols],
  );

  useEffect(() => {
    if (!slug || !xCol || activeYCols.length === 0) {
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
        filter: { dateColumn, dateFrom, dateTo, dimensions: {} },
        xColumn: xCol,
        groupColumn: null,
        metrics: activeYCols.map(({ col, fn }) => ({ col, fn })),
        limit: 10000,
      }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setData(j as AggResp);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "집계 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, xCol, dateColumn, dateFrom, dateTo, metricsKey]);

  // Pivot server rows into chart-ready shape (no group column → each metric
  // is its own series, keyed by the source_header label).
  const { chartRows, seriesKeys, seriesAxis, metricTotals, salesAlias, costAlias } =
    useMemo(() => {
      const empty = {
        chartRows: [] as Record<string, unknown>[],
        seriesKeys: [] as string[],
        seriesAxis: new Map<string, Axis>(),
        metricTotals: [] as { label: string; fn: AggFn; total: number }[],
        salesAlias: null as string | null,
        costAlias: null as string | null,
      };
      if (!data?.rows?.length) return empty;
      const colMap = new Map(columns.map((c) => [c.column_name, c]));
      const yLabels = data.metricColumns.map((m) => {
        const c = colMap.get(m.col);
        const base = c?.source_header ?? m.col;
        return m.fn === "sum" ? base : `${base}(${m.fn})`;
      });
      const totals = data.metricColumns.map((m, i) => {
        const serverTotal = data.totals?.find(
          (t) => t.col === m.col && t.fn === m.fn,
        );
        return { label: yLabels[i], fn: m.fn, total: serverTotal?.total ?? 0 };
      });
      const axisByKey = new Map<string, Axis>(
        activeYCols.map((y) => [`${y.col}|${y.fn}`, y.axis]),
      );
      const axisFor = (m: { col: string; fn: AggFn }): Axis =>
        axisByKey.get(`${m.col}|${m.fn}`) ?? "left";

      const seriesAxis = new Map<string, Axis>();
      const sortedRows = [...data.rows].sort((a, b) =>
        String(a.x) < String(b.x) ? -1 : 1,
      );
      const chartRows = sortedRows.map((r) => {
        const out: Record<string, unknown> = { x: r.x };
        data.metricColumns.forEach((m, i) => {
          out[yLabels[i]] = r[m.alias] == null ? null : Number(r[m.alias]);
        });
        return out;
      });
      data.metricColumns.forEach((m, i) => {
        seriesAxis.set(yLabels[i], axisFor(m));
      });

      // Aliases of sales/total_cost when both are summed → enables ROAS toggle
      // and the monthly ROAS overlay.
      const salesM = data.metricColumns.find(
        (m) => m.col === "sales" && m.fn === "sum",
      );
      const costM = data.metricColumns.find(
        (m) => m.col === "total_cost" && m.fn === "sum",
      );

      return {
        chartRows,
        seriesKeys: yLabels,
        seriesAxis,
        metricTotals: totals,
        salesAlias: salesM?.alias ?? null,
        costAlias: costM?.alias ?? null,
      };
    }, [data, columns, activeYCols]);

  const roasAvailable = !!salesAlias && !!costAlias;

  // Inject a derived ROAS series into chartRows when toggled on.
  const renderRows = useMemo(() => {
    if (!showRoas || !roasAvailable) return chartRows;
    return chartRows.map((row) => {
      // Series labels were used as keys above — find sales/cost by their labels
      const colMap = new Map(columns.map((c) => [c.column_name, c]));
      const salesLabel = colMap.get("sales")?.source_header ?? "sales";
      const costLabel = colMap.get("total_cost")?.source_header ?? "total_cost";
      const s = Number(row[salesLabel]);
      const c = Number(row[costLabel]);
      const roas = Number.isFinite(s) && Number.isFinite(c) && c > 0 ? s / c : null;
      return { ...row, ROAS: roas };
    });
  }, [chartRows, columns, showRoas, roasAvailable]);

  // Monthly overlay: use the first active metric as the "primary" — same as
  // the campaign chart. ROAS in the overlay only when both sales+cost (sum)
  // are present.
  const monthlyBuckets: BucketInfo[] = useMemo(() => {
    if (!showWeeklyAvg) return [];
    if (!data?.rows?.length) return [];
    const primaryMetric = data.metricColumns[0];
    if (!primaryMetric) return [];
    const colMap = new Map(columns.map((c) => [c.column_name, c]));
    const c = colMap.get(primaryMetric.col);
    const primaryLabel =
      primaryMetric.fn === "sum"
        ? c?.source_header ?? primaryMetric.col
        : `${c?.source_header ?? primaryMetric.col}(${primaryMetric.fn})`;

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
      if (salesAlias && costAlias) {
        const s = Number(r[salesAlias]);
        const cc = Number(r[costAlias]);
        if (Number.isFinite(s)) w.salesSum += s;
        if (Number.isFinite(cc)) w.costSum += cc;
      }
    }
    const sortedBuckets = Array.from(byMonth.keys()).sort();
    const years = new Set(sortedBuckets.map((s) => s.slice(0, 4)));
    const multiYear = years.size > 1;
    return sortedBuckets.map((bucketStart) => {
      const b = byMonth.get(bucketStart)!;
      const dates = Array.from(b.dates).sort();
      const days = b.dates.size;
      const roas =
        salesAlias && costAlias && b.costSum > 0 && Number.isFinite(b.salesSum / b.costSum)
          ? b.salesSum / b.costSum
          : null;
      return {
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        label: monthLabel(bucketStart, multiYear),
        primaryAvg: days > 0 ? b.sum / days : 0,
        primaryLabel,
        days,
        roas,
      };
    });
  }, [data, showWeeklyAvg, columns, salesAlias, costAlias]);

  const xLabel = columns.find((c) => c.column_name === xCol)?.source_header ?? xCol;
  const xColIsDate = (() => {
    const c = columns.find((col) => col.column_name === xCol);
    return c?.data_type === "date" || c?.data_type === "timestamp";
  })();

  // Prune hidden labels that no longer correspond to a current series — keeps
  // the set tight after the user removes a Y axis upstream.
  useEffect(() => {
    setHiddenSeries((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(seriesKeys);
      const next = new Set([...prev].filter((k) => valid.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [seriesKeys]);

  const visibleSeriesKeys = useMemo(
    () => seriesKeys.filter((k) => !hiddenSeries.has(k)),
    [seriesKeys, hiddenSeries],
  );

  function toggleSeries(label: string) {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <div className="p-4 rounded-lg border-2 border-amber-500/40 bg-amber-500/[0.03] shadow-lg shadow-amber-500/10 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold uppercase tracking-wide text-amber-300">
            Brand 전체
          </span>
          <span className="text-[11px] text-gray-500">
            상단 차트의 X / Y / 옵션을 그대로 따라가며, 캠페인·서치텀·타겟 필터는 무시하고 공통 기간 전체 합계만 보여줍니다.
          </span>
        </div>
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-300">
          {seriesKeys.map((k, i) => {
            const visible = !hiddenSeries.has(k);
            const color = COLORS[i % COLORS.length];
            return (
              <label
                key={k}
                className={`inline-flex items-center gap-1.5 cursor-pointer ${
                  visible ? "" : "opacity-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => toggleSeries(k)}
                  className="accent-amber-400"
                />
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate max-w-[160px]" title={k}>
                  {k}
                </span>
              </label>
            );
          })}
          {roasAvailable && (
            <label
              className={`inline-flex items-center gap-1.5 cursor-pointer pl-3 border-l border-amber-500/20 ${
                showRoas ? "" : "opacity-70"
              }`}
            >
              <input
                type="checkbox"
                checked={showRoas}
                onChange={(e) => setShowRoas(e.target.checked)}
                className="accent-amber-400"
              />
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: ROAS_COLOR }}
              />
              <span>ROAS 일간 추이</span>
            </label>
          )}
        </div>
      </div>

      {metricTotals.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-gray-500">기간 누적:</span>
          {metricTotals.map((m) => (
            <div key={m.label} className="inline-flex items-baseline gap-1.5">
              <span className="text-gray-400">{m.label}:</span>
              <span className="text-cyan-300 font-semibold tabular-nums">
                {fmtTotal(m.total)}
              </span>
              {m.fn !== "sum" && (
                <span className="text-[10px] text-gray-500">
                  (일/그룹 {m.fn} 누적)
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="h-[360px] relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm z-10 rounded-md">
            <Loader2 className="animate-spin text-amber-400" size={20} />
          </div>
        )}
        {error ? (
          <div className="h-full flex items-center justify-center text-sm text-rose-400">
            {error}
          </div>
        ) : activeYCols.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            상단 차트에서 Y 축을 한 개 이상 선택하세요.
          </div>
        ) : chartRows.length === 0 && !loading ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            선택한 기간에 표시할 데이터가 없습니다.
          </div>
        ) : kind === "pie" && !visibleSeriesKeys[0] ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Pie 는 Y 축 1개가 필요합니다.
          </div>
        ) : visibleSeriesKeys.length === 0 && !(showRoas && roasAvailable) ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            표시할 시리즈가 없습니다 — 위 토글을 켜주세요.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart(
              kind,
              renderRows,
              xLabel,
              visibleSeriesKeys,
              seriesAxis,
              logScale,
              monthlyBuckets,
              showRoas && roasAvailable,
              xColIsDate ? events ?? [] : [],
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function monthBucketStart(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-01`;
}

function monthLabel(bucketStart: string, multiYear: boolean): string {
  const m = /^(\d{4})-(\d{2})/.exec(bucketStart);
  if (!m) return bucketStart;
  if (multiYear) return `${m[1]}.${m[2]}`;
  return `${Number(m[2])}월`;
}

function fmtAvgMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + Math.round(n).toLocaleString();
}

/** Estimate half-width (in SVG px) of a bucket-overlay label rendered at
 *  fontSize 12, fontWeight 700, with a 3px outline stroke. CJK glyphs are
 *  ~2x ASCII width. Used to clamp the label's x so it never extends past
 *  the chart's plot area. */
function estimateBucketLabelHalfWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (
      /[　-〿㐀-䶿一-鿿가-힯＀-￯]/.test(
        ch,
      )
    ) {
      w += 13;
    } else {
      w += 7.2;
    }
  }
  return (w + 6) / 2;
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

function renderChart(
  kind: ChartKind,
  data: Record<string, unknown>[],
  xLabel: string,
  seriesKeys: string[],
  seriesAxis: Map<string, Axis>,
  logScale: boolean,
  buckets: BucketInfo[],
  withRoas: boolean,
  events: BrandEvent[],
) {
  // ContributionChart 와 동일한 패턴: ReferenceArea 의 label prop 으로 음영과
  // 라벨을 같이 그린다. Customized 로 그리면 categorical X축에서 scale 매칭이
  // 실패하거나 시리즈에 가려져서 라벨이 안 보이는 사례가 있다.
  const eventOverlay = events.map((e) => {
    const c = eventColors(e.color);
    return (
      <ReferenceArea
        key={`evt-${e.id}`}
        x1={e.start_date}
        x2={e.end_date}
        yAxisId="left"
        fill={c.fill}
        stroke={c.stroke}
        strokeDasharray="2 2"
        ifOverflow="hidden"
        label={{
          position: "insideTop",
          content: (props) => {
            const vb = (
              props as {
                viewBox?: { x?: number; y?: number; width?: number; height?: number };
              }
            ).viewBox;
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
            const topY = vb.y + 14;
            return (
              <text
                x={cx}
                y={topY}
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
  });
  // Rectangles only — labels are drawn separately via <Customized> below so
  // they aren't subject to the ReferenceArea's plot-area clip path.
  const bucketRects = buckets.map((b) => (
    <ReferenceArea
      key={b.firstDate}
      x1={b.firstDate}
      x2={b.lastDate}
      yAxisId="left"
      fill="rgba(245, 158, 11, 0.05)"
      stroke="rgba(245, 158, 11, 0.25)"
      strokeDasharray="2 3"
      ifOverflow="hidden"
    />
  ));

  const bucketLabels =
    buckets.length > 0 ? (
      <Customized
        key="bucket-labels"
        component={(props: unknown) => {
          const p = props as {
            xAxisMap?: Record<string, { scale?: (v: unknown) => number }>;
            offset?: { left?: number; top?: number; width?: number };
          };
          const xAxes = p.xAxisMap ? Object.values(p.xAxisMap) : [];
          const xScale = xAxes[0]?.scale;
          const offset = p.offset;
          if (
            !xScale ||
            !offset ||
            offset.left == null ||
            offset.top == null ||
            offset.width == null
          ) {
            return null;
          }
          const plotLeft = offset.left;
          const plotRight = offset.left + offset.width;
          const topY = offset.top + 14;
          return (
            <g>
              {buckets.map((b) => {
                const x1 = xScale(b.firstDate);
                const x2 = xScale(b.lastDate);
                if (typeof x1 !== "number" || typeof x2 !== "number") return null;
                const bucketCx = (x1 + x2) / 2;
                const text1 = `${b.label} · 일평균 ${fmtAvgMoney(b.primaryAvg)} (${b.days}일)`;
                const text2 = b.roas != null ? `ROAS ${b.roas.toFixed(2)}` : null;
                const halfW = Math.max(
                  estimateBucketLabelHalfWidth(text1),
                  text2 ? estimateBucketLabelHalfWidth(text2) : 0,
                );
                const minCx = plotLeft + halfW;
                const maxCx = plotRight - halfW;
                const cx =
                  minCx > maxCx
                    ? (plotLeft + plotRight) / 2
                    : Math.max(minCx, Math.min(maxCx, bucketCx));
                return (
                  <g key={b.firstDate}>
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
                      {text1}
                    </text>
                    {text2 && (
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
                        {text2}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        }}
      />
    ) : null;
  const bucketOverlay = (
    <>
      {bucketRects}
      {bucketLabels}
    </>
  );

  const axisOf = (k: string): Axis => seriesAxis.get(k) ?? "left";
  const hasRight = seriesKeys.some((k) => axisOf(k) === "right") || withRoas;
  const yScale = logScale ? ("log" as const) : ("auto" as const);
  const yDomain: [number | string, number | string] = ["auto", "auto"];
  const AXIS_TICK = { fontSize: 10, fill: "#9ca3af" } as const;
  const AXIS_LABEL = { fontSize: 11, fill: "#9ca3af" } as const;
  const TOOLTIP_CONTENT_STYLE = {
    fontSize: 11,
    padding: "6px 8px",
    lineHeight: 1.4,
    backgroundColor: "#1e293b",
    border: "1px solid rgba(245, 158, 11, 0.3)",
    borderRadius: 8,
    color: "#e5e7eb",
  } as const;
  const TOOLTIP_ITEM_STYLE = { padding: 0, color: "#e5e7eb" } as const;
  const TOOLTIP_LABEL_STYLE = {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 2,
    color: "#fbbf24",
  } as const;
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
    label: {
      value: xLabel,
      position: "insideBottom" as const,
      offset: -5,
      style: AXIS_LABEL,
    },
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

  const roasSeries = withRoas ? (
    <Line
      key="ROAS"
      type="monotone"
      dataKey="ROAS"
      yAxisId="right"
      stroke={ROAS_COLOR}
      strokeWidth={1.5}
      strokeDasharray="4 3"
      dot={false}
      connectNulls
    />
  ) : null;

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
          {eventOverlay}
          {bucketOverlay}
          {seriesKeys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              yAxisId={axisOf(k)}
              fill={COLORS[i % COLORS.length]}
            />
          ))}
          {roasSeries}
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
          {eventOverlay}
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
          {roasSeries}
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
          {eventOverlay}
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
          {roasSeries}
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
