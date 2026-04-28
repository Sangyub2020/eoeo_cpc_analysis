"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { X, Loader2, Search } from "lucide-react";
import AsinLinkified from "@/components/reports/AsinLinkified";
import type { FilterState } from "@/lib/reports/filter";

interface DistPoint {
  rk: number;
  cum: number;
  s: number;
  v: string;
}

interface FullRow {
  rk: number;
  v: string;
  s: number;
}

interface SampledResponse {
  n: number;
  totalSales: number;
  points: DistPoint[];
}

interface FullResponse {
  n: number;
  totalSales: number;
  rows: FullRow[];
}

interface Props {
  slug: string;
  column: string;
  metric: { col: string; fn: "sum" | "avg" | "min" | "max" | "count" };
  filter: FilterState;
  /** Currently-selected Top-N from the parent chart — used to draw a highlight band. */
  topN: number;
  stackLabel: string;
  metricLabel: string;
  onClose: () => void;
}

const THRESHOLDS = [0.5, 0.8, 0.9, 0.95];
const ROW_HEIGHT = 26;
const ROW_BUFFER = 8;

export default function CumulativeDistributionModal({
  slug,
  column,
  metric,
  filter,
  topN,
  stackLabel,
  metricLabel,
  onClose,
}: Props) {
  const [data, setData] = useState<SampledResponse | null>(null);
  const [fullData, setFullData] = useState<FullResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullLoading, setFullLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setFullLoading(true);
    setError(null);
    setData(null);
    setFullData(null);

    const sampled = fetch(`/api/reports/${slug}/cumulative-distribution`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ column, metric, filter, mode: "sampled" }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (abort.signal.aborted) return;
        if (j.error) throw new Error(j.error);
        setData(j as SampledResponse);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });

    const full = fetch(`/api/reports/${slug}/cumulative-distribution`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ column, metric, filter, mode: "full" }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (abort.signal.aborted) return;
        if (j.error) throw new Error(j.error);
        setFullData(j as FullResponse);
      })
      .finally(() => {
        if (!abort.signal.aborted) setFullLoading(false);
      });

    Promise.all([sampled, full]).catch((e) => {
      if ((e as Error).name === "AbortError") return;
      if (abort.signal.aborted) return;
      setError(e instanceof Error ? e.message : "조회 실패");
    });

    return () => abort.abort();
  }, [slug, column, metric, filter]);

  // Lock body scroll while open.
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

  const chart = useMemo(() => {
    if (!data || data.totalSales <= 0 || data.points.length === 0) return null;
    return data.points.map((p) => ({
      rk: p.rk,
      cumPct: (p.cum / data.totalSales) * 100,
      cum: p.cum,
    }));
  }, [data]);

  const thresholdRanks = useMemo(() => {
    if (!data || data.totalSales <= 0) return [];
    const tgt = THRESHOLDS.map((t) => t * data.totalSales);
    const out: { pct: number; rk: number; cum: number; cumPct: number }[] = [];
    for (let i = 0; i < THRESHOLDS.length; i++) {
      const need = tgt[i];
      const hit = data.points.find((p) => p.cum >= need);
      if (hit) {
        out.push({
          pct: THRESHOLDS[i] * 100,
          rk: hit.rk,
          cum: hit.cum,
          cumPct: (hit.cum / data.totalSales) * 100,
        });
      }
    }
    return out;
  }, [data]);

  const topNStat = useMemo(() => {
    if (!data || data.totalSales <= 0) return null;
    let last: DistPoint | null = null;
    for (const p of data.points) {
      if (p.rk <= topN) last = p;
      else break;
    }
    if (!last) return null;
    return {
      rk: last.rk,
      cum: last.cum,
      cumPct: (last.cum / data.totalSales) * 100,
    };
  }, [data, topN]);

  const filterRange = (() => {
    const { dateFrom, dateTo } = filter;
    if (!dateFrom && !dateTo) return "전체 기간";
    return `${dateFrom ?? "처음"} ~ ${dateTo ?? "끝"}`;
  })();

  // Use the more authoritative full-list n / totalSales when available.
  const displayN = fullData?.n ?? data?.n ?? 0;
  const displayTotal = fullData?.totalSales ?? data?.totalSales ?? 0;

  const body = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-7xl max-h-[90vh] flex flex-col rounded-lg border border-cyan-500/30 bg-slate-900 shadow-2xl shadow-cyan-500/10">
        <div className="px-5 py-3 border-b border-cyan-500/20 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-500 uppercase tracking-wide">
              {stackLabel} · {metricLabel} 누적 분포
            </div>
            <div className="text-base font-semibold text-gray-100 mt-0.5">
              매출이 어떻게 분산되어 있는지 한눈에 보기
            </div>
            <div className="text-xs text-gray-400 mt-1">기간: {filterRange}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-rose-300 hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* LEFT: chart + stats + thresholds */}
          <div className="flex-1 min-w-0 p-5 overflow-auto">
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
                <Loader2 size={14} className="animate-spin text-cyan-400" /> 분포 계산 중...
              </div>
            ) : error ? (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
                {error}
              </div>
            ) : !data || data.n === 0 ? (
              <div className="p-8 text-sm text-gray-500 text-center">
                해당 조건에서 매출이 발생한 {stackLabel}이 없습니다.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatCard
                    label={`${stackLabel} 수`}
                    value={displayN.toLocaleString() + "개"}
                    hint={`매출 > 0 인 ${stackLabel}`}
                  />
                  <StatCard
                    label="합계 매출"
                    value={fmtUSD(displayTotal)}
                    hint="이 분포의 총합"
                  />
                  <StatCard
                    label={`Top ${topN.toLocaleString()} 비중`}
                    value={topNStat ? `${topNStat.cumPct.toFixed(1)}%` : "—"}
                    hint={topNStat ? fmtUSD(topNStat.cum) : ""}
                    accent="cyan"
                  />
                  <StatCard
                    label="매출 90% 도달"
                    value={
                      thresholdRanks.find((t) => t.pct === 90)
                        ? `상위 ${thresholdRanks
                            .find((t) => t.pct === 90)!
                            .rk.toLocaleString()}개`
                        : "—"
                    }
                    hint={
                      thresholdRanks.find((t) => t.pct === 90) && data.n > 0
                        ? `전체의 ${(
                            (thresholdRanks.find((t) => t.pct === 90)!.rk /
                              data.n) *
                            100
                          ).toFixed(1)}%`
                        : ""
                    }
                    accent="purple"
                  />
                </div>

                <div className="rounded-md border border-cyan-500/15 overflow-hidden">
                  <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 bg-slate-800/40 border-b border-cyan-500/10">
                    <span>매출 누적</span>
                    <span className="text-right">필요한 상위 {stackLabel} 수</span>
                    <span className="text-right">전체 대비</span>
                  </div>
                  {thresholdRanks.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500">—</div>
                  ) : (
                    thresholdRanks.map((t) => (
                      <div
                        key={t.pct}
                        className="grid grid-cols-3 px-3 py-1.5 text-xs border-b border-cyan-500/5 last:border-b-0"
                      >
                        <span className="text-gray-300">{t.pct.toFixed(0)}%</span>
                        <span className="text-right tabular-nums text-cyan-300 font-semibold">
                          {t.rk.toLocaleString()}개
                        </span>
                        <span className="text-right tabular-nums text-gray-400">
                          {((t.rk / data.n) * 100).toFixed(2)}%
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div className="rounded-md border border-cyan-500/15 bg-slate-900/40 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
                    <span>
                      상위 N {stackLabel} 누적 매출 비중 (X축: 로그 스케일)
                    </span>
                    <span className="text-gray-500">
                      Y = 그 시점까지의 누적 매출 / 전체 매출
                    </span>
                  </div>
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={chart ?? []}
                        margin={{ top: 10, right: 24, bottom: 24, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                        <XAxis
                          dataKey="rk"
                          type="number"
                          scale="log"
                          domain={[1, data.n]}
                          allowDataOverflow
                          ticks={logTicks(data.n)}
                          tickFormatter={(v) => fmtRank(Number(v))}
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          label={{
                            value: `상위 N ${stackLabel}`,
                            position: "insideBottom",
                            offset: -10,
                            fill: "#9ca3af",
                            fontSize: 11,
                          }}
                        />
                        <YAxis
                          domain={[0, 100]}
                          ticks={[0, 25, 50, 75, 90, 100]}
                          tickFormatter={(v) => `${v}%`}
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          width={42}
                        />
                        <Tooltip
                          contentStyle={{
                            fontSize: 11,
                            padding: "6px 8px",
                            background: "#0f172a",
                            border: "1px solid rgba(34,211,238,0.3)",
                          }}
                          labelFormatter={(v) =>
                            `상위 ${Number(v).toLocaleString()}개 ${stackLabel}`
                          }
                          formatter={(value: unknown, name: unknown, item) => {
                            if (name === "cumPct") {
                              const pct = Number(value);
                              const cum =
                                (item?.payload as { cum?: number } | undefined)
                                  ?.cum ?? 0;
                              return [
                                `${pct.toFixed(1)}% · ${fmtUSD(cum)}`,
                                "누적 매출 비중",
                              ];
                            }
                            return [String(value), String(name)];
                          }}
                        />
                        {topN > 1 && topN <= data.n && (
                          <ReferenceArea
                            x1={1}
                            x2={topN}
                            fill="rgba(34, 211, 238, 0.08)"
                            stroke="rgba(34, 211, 238, 0.3)"
                            strokeDasharray="3 3"
                            label={{
                              value: `Top ${topN}`,
                              position: "insideTopRight",
                              fill: "#67e8f9",
                              fontSize: 10,
                            }}
                          />
                        )}
                        {thresholdRanks.map((t) => (
                          <ReferenceLine
                            key={"y" + t.pct}
                            y={t.pct}
                            stroke="rgba(168, 85, 247, 0.3)"
                            strokeDasharray="2 4"
                            label={{
                              value: `${t.pct.toFixed(0)}%`,
                              position: "right",
                              fill: "#c4b5fd",
                              fontSize: 10,
                            }}
                          />
                        ))}
                        {thresholdRanks.map((t) => (
                          <ReferenceDot
                            key={"d" + t.pct}
                            x={t.rk}
                            y={t.cumPct}
                            r={3}
                            fill="#a855f7"
                            stroke="#0f172a"
                            strokeWidth={1.5}
                          />
                        ))}
                        <Line
                          type="monotone"
                          dataKey="cumPct"
                          stroke="#22d3ee"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                    곡선이 빨리 평평해질수록 소수의 키워드에 매출이 집중되어
                    있습니다. 곡선이 늦게 90%에 도달할수록 long-tail (수많은
                    소액 키워드의 합)에 의존하는 구조라는 뜻입니다.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: full keyword list (virtualized) */}
          <FullKeywordList
            stackLabel={stackLabel}
            data={fullData}
            loading={fullLoading}
          />
        </div>
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(body, document.body);
}

function FullKeywordList({
  stackLabel,
  data,
  loading,
}: {
  stackLabel: string;
  data: FullResponse | null;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Track viewport height — modal can resize and we want the visible window
  // calculation to match the actual scrollable area.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) => r.v.toLowerCase().includes(q));
  }, [data, search]);

  // Reset scroll when the result set shrinks under the cursor (search change),
  // otherwise the virtualizer may compute an out-of-range slice and look empty.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [search]);

  const totalH = filtered.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_BUFFER);
  const endIdx = Math.min(
    filtered.length,
    Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + ROW_BUFFER,
  );
  const visible = filtered.slice(startIdx, endIdx);
  const padTop = startIdx * ROW_HEIGHT;

  const totalSales = data?.totalSales ?? 0;

  async function copyValue(e: React.MouseEvent, value: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(
        () => setCopied((k) => (k === value ? null : k)),
        1200,
      );
    } catch {
      // ignore
    }
  }

  return (
    <div className="shrink-0 w-[420px] border-l border-cyan-500/20 bg-slate-900/60 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-cyan-500/20">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-300 font-medium">
            전체 {stackLabel}
            {data && (
              <span className="text-gray-500 ml-1.5">
                ({filtered.length.toLocaleString()}
                {search && data.rows.length !== filtered.length
                  ? ` / ${data.rows.length.toLocaleString()}`
                  : ""}
                )
              </span>
            )}
          </span>
          {loading && <Loader2 size={11} className="animate-spin text-cyan-400" />}
        </div>
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${stackLabel} 검색`}
            className="w-full pl-6 pr-2 py-1 text-xs rounded border border-cyan-500/20 bg-slate-900 text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="px-2 py-1 border-b border-cyan-500/10 flex items-center gap-2 text-[10px] text-gray-500 uppercase tracking-wide">
        <span className="w-10 text-right shrink-0">#</span>
        <span className="flex-1 min-w-0">{stackLabel}</span>
        <span className="w-16 text-right shrink-0">매출</span>
        <span className="w-12 text-right shrink-0">비중</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 overflow-auto min-h-0"
      >
        {loading ? (
          <div className="p-6 text-xs text-gray-500 text-center">
            전체 키워드 로딩 중...
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="p-6 text-xs text-gray-500 text-center">—</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-xs text-gray-500 text-center">
            일치하는 값이 없습니다
          </div>
        ) : (
          <div style={{ height: totalH, position: "relative" }}>
            <div style={{ paddingTop: padTop }}>
              {visible.map((r) => {
                const share = totalSales > 0 ? (r.s / totalSales) * 100 : 0;
                return (
                  <div
                    key={r.rk}
                    style={{ height: ROW_HEIGHT }}
                    className="flex items-center gap-2 px-2 text-xs hover:bg-white/5 border-b border-cyan-500/5"
                  >
                    <span className="w-10 text-right shrink-0 tabular-nums text-gray-500">
                      {r.rk.toLocaleString()}
                    </span>
                    <span
                      className="flex-1 min-w-0 truncate text-gray-200 cursor-context-menu"
                      title={`${r.v}\n우클릭: 복사`}
                      onContextMenu={(e) => copyValue(e, r.v)}
                    >
                      <AsinLinkified text={r.v} />
                      {copied === r.v && (
                        <span className="ml-1.5 text-[10px] text-emerald-300 animate-pulse">
                          복사됨
                        </span>
                      )}
                    </span>
                    <span className="w-16 text-right shrink-0 tabular-nums text-gray-300">
                      {fmtUSD(r.s)}
                    </span>
                    <span className="w-12 text-right shrink-0 tabular-nums text-cyan-300/80">
                      {fmtPct(share)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-cyan-500/15 text-[10px] text-gray-500">
        우클릭: 키워드 복사 · 스크롤로 전체 탐색
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "cyan" | "purple";
}) {
  const valueColor =
    accent === "cyan"
      ? "text-cyan-300"
      : accent === "purple"
        ? "text-purple-300"
        : "text-gray-100";
  return (
    <div className="rounded-md border border-cyan-500/15 bg-slate-800/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums mt-0.5 ${valueColor}`}>
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-gray-500 mt-0.5 truncate" title={hint}>
          {hint}
        </div>
      )}
    </div>
  );
}

function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return "$" + Math.round(n).toLocaleString();
  if (abs >= 1) return "$" + n.toFixed(0);
  return "$" + n.toFixed(2);
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 10) return n.toFixed(1) + "%";
  if (n >= 1) return n.toFixed(2) + "%";
  if (n >= 0.01) return n.toFixed(2) + "%";
  return "<0.01%";
}

function fmtRank(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

function logTicks(maxN: number): number[] {
  const out: number[] = [];
  let v = 1;
  while (v <= maxN) {
    out.push(v);
    if (v < maxN && v * 5 <= maxN) out.push(v * 5);
    v *= 10;
  }
  if (out[out.length - 1] !== maxN) out.push(maxN);
  return out.filter((t, i, a) => a.indexOf(t) === i);
}
