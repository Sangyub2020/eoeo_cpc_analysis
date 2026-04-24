"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { Loader2 } from "lucide-react";
import type { FilterState } from "@/lib/reports/filter";
import type { ReportColumn } from "@/lib/reports/types";
import { fmtShortDate } from "@/lib/reports/format";
import { TermPanel, type SharedTermStat } from "@/components/reports/ContributionChart";

const COLORS = [
  "#22d3ee", "#a855f7", "#10b981", "#f59e0b", "#f43f5e",
  "#38bdf8", "#84cc16", "#e879f9", "#fb7185", "#fbbf24",
  "#06b6d4", "#8b5cf6", "#14b8a6", "#eab308", "#ec4899",
  "#0ea5e9", "#65a30d", "#d946ef", "#f97316", "#3b82f6",
  "#2dd4bf", "#c084fc", "#4ade80", "#fb923c", "#e11d48",
];

const DEFAULT_STACK_COL = "search_term";
const COST_COL = "total_cost";
const SALES_COL = "sales";

const COST_SUFFIX = "__cost";
const ROAS_SUFFIX = "__roas";

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
  /** Optional drill-down handler — forwarded to TermPanel's per-row button. */
  onDrill?: (value: string) => void;
}

export default function RoasChart({
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
}: Props) {
  const STACK_COL = stackColumn;
  const stackCol = columns.find((c) => c.column_name === STACK_COL);
  const costCol = columns.find((c) => c.column_name === COST_COL);
  const salesCol = columns.find((c) => c.column_name === SALES_COL);
  const xCol = columns.find((c) => c.data_type === "date" || c.data_type === "timestamp");

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [perTermDaily, setPerTermDaily] = useState<
    Map<string, { date: string; sales: number; cost: number }[]>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRoas, setShowRoas] = useState(true);

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
    if (!stackCol || !costCol || !salesCol || !xCol) return;
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
              { col: COST_COL, fn: "sum" },
              { col: SALES_COL, fn: "sum" },
            ],
            limit: 20000,
          }),
          signal: abort.signal,
        });
        const aggJson = await aggRes.json();
        if (!aggRes.ok) throw new Error(aggJson.error ?? `aggregate HTTP ${aggRes.status}`);

        // m0 = cost, m1 = sales
        const byX = new Map<string, Record<string, unknown>>();
        const perTerm = new Map<string, { date: string; sales: number; cost: number }[]>();

        for (const r of (aggJson.rows ?? []) as {
          x: string;
          g?: string;
          m0?: number;
          m1?: number;
        }[]) {
          const term = String(r.g ?? "");
          const cost = Number(r.m0 ?? 0);
          const sales = Number(r.m1 ?? 0);

          const xk = String(r.x);
          let row = byX.get(xk);
          if (!row) {
            row = { x: r.x };
            byX.set(xk, row);
          }
          row[term + COST_SUFFIX] = Number.isFinite(cost) ? cost : null;
          row[term + ROAS_SUFFIX] =
            cost > 0 && Number.isFinite(cost) && Number.isFinite(sales)
              ? sales / cost
              : null;

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

  if (!stackCol || !costCol || !salesCol || !xCol) return null;

  const stackLabel = stackCol.source_header;
  const costLabel = costCol.source_header;

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

  // Monthly overlay — only when EXACTLY one term visible
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
        avgCost: days > 0 ? b.costSum / days : 0,
        days,
        roas: b.costSum > 0 ? b.salesSum / b.costSum : null,
      };
    });
  }, [sharedTerms, hidden, perTermDaily]);

  const busy = termsLoading || loading;

  return (
    <div className="p-4 rounded-lg border border-purple-500/20 bg-slate-900/80 shadow-lg shadow-purple-500/10 text-gray-300 relative z-10">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-gray-100">
          일자별 {stackLabel} ROAS + Cost{" "}
          <span className="text-gray-500">
            (누적 {costLabel} 상위 · 막대=Cost, 선=ROAS)
          </span>
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
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRoas}
            onChange={(e) => setShowRoas(e.target.checked)}
            className="accent-cyan-500"
          />
          ROAS 선 표시
        </label>
        <div className="flex-1" />
        {busy && <Loader2 size={12} className="animate-spin text-cyan-400" />}
      </div>

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
              <ComposedChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis
                  dataKey="x"
                  tickFormatter={fmtShortDate}
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  tickFormatter={fmtAxisCost}
                />
                <YAxis yAxisId="right" orientation="right" hide />
                {showRoas && (
                  <ReferenceLine
                    y={1}
                    yAxisId="right"
                    stroke="#64748b"
                    strokeDasharray="4 4"
                    label={{ value: "ROAS=1", position: "right", fontSize: 9, fill: "#94a3b8" }}
                  />
                )}
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    padding: "6px 8px",
                    lineHeight: 1.4,
                    maxHeight: 360,
                    overflowY: "auto",
                    backgroundColor: "#1e293b",
                    border: "1px solid rgba(168,85,247,0.3)",
                    borderRadius: 8,
                    color: "#e5e7eb",
                  }}
                  itemStyle={{ padding: 0 }}
                  labelStyle={{ fontSize: 11, fontWeight: 600, marginBottom: 2, color: "#22d3ee" }}
                  labelFormatter={(v) => fmtShortDate(v)}
                  formatter={(value, name) => {
                    const n = typeof value === "number" ? value : Number(value);
                    const key = String(name);
                    if (key.endsWith(COST_SUFFIX)) {
                      return [fmtMoney(n), key.slice(0, -COST_SUFFIX.length) + " · Cost"];
                    }
                    if (key.endsWith(ROAS_SUFFIX)) {
                      return [
                        Number.isFinite(n) ? n.toFixed(2) : "—",
                        key.slice(0, -ROAS_SUFFIX.length) + " · ROAS",
                      ];
                    }
                    return [String(value), key];
                  }}
                  itemSorter={(item) => {
                    const key = String(item.name ?? "");
                    if (key.endsWith(COST_SUFFIX))
                      return key.slice(0, -COST_SUFFIX.length) + "|0";
                    if (key.endsWith(ROAS_SUFFIX))
                      return key.slice(0, -ROAS_SUFFIX.length) + "|1";
                    return key;
                  }}
                  wrapperStyle={{ zIndex: 9999, pointerEvents: "none" }}
                  allowEscapeViewBox={{ x: true, y: true }}
                />
                {monthlyBuckets.map((b) => (
                  <ReferenceArea
                    key={b.firstDate + "_bg"}
                    x1={b.firstDate}
                    x2={b.lastDate}
                    yAxisId="left"
                    fill="rgba(168, 85, 247, 0.04)"
                    stroke="rgba(168, 85, 247, 0.2)"
                    strokeDasharray="2 3"
                    ifOverflow="hidden"
                  />
                ))}
                {sharedTerms.map((t) => {
                  if (hidden.has(t.value)) return null;
                  const color = colorOf(t.value);
                  return (
                    <Bar
                      key={t.value + "_bar"}
                      dataKey={t.value + COST_SUFFIX}
                      stackId="cost"
                      yAxisId="left"
                      fill={color}
                      fillOpacity={0.6}
                    />
                  );
                })}
                {showRoas &&
                  sharedTerms.map((t) => {
                    if (hidden.has(t.value)) return null;
                    const color = colorOf(t.value);
                    return (
                      <Line
                        key={t.value + "_line"}
                        type="monotone"
                        dataKey={t.value + ROAS_SUFFIX}
                        yAxisId="right"
                        stroke={color}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    );
                  })}
                {monthlyBuckets.map((b) => (
                  <ReferenceArea
                    key={b.firstDate + "_lbl"}
                    x1={b.firstDate}
                    x2={b.lastDate}
                    yAxisId="left"
                    fill="transparent"
                    stroke="none"
                    ifOverflow="hidden"
                    label={{
                      position: "insideTop",
                      content: (props) => {
                        const vb = (
                          props as { viewBox?: { x?: number; y?: number; width?: number } }
                        ).viewBox;
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
                              {b.label} · 일평균 {fmtAvgMoney(b.avgCost)}
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
              </ComposedChart>
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

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return "$" + Math.round(n).toLocaleString();
  if (abs >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function fmtAvgMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return "$" + Math.round(n).toLocaleString();
}

function fmtAxisCost(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n;
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
