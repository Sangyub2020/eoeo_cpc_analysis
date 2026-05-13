"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import SimpleMarkdown from "@/components/reports/SimpleMarkdown";
import CampaignCombobox from "@/components/reports/CampaignCombobox";

interface Props {
  brand: string;
  /** 브랜드 페이지가 알고 있는 데이터 범위 — 캘린더의 min/max 와 동일. */
  minDate?: string;
  maxDate?: string;
  /** 캠페인 드릴다운에 쓸 캠페인 후보를 가져올 distinct 엔드포인트의 슬러그.
   *  보통 brand 페이지의 primary report_type (sp_search_term). */
  primarySlug: string | null;
  /** campaign_name → nickname. 캠페인 드롭다운의 라벨로 사용 (있으면 닉네임 강조). */
  nicknames?: Record<string, string>;
  /** 시작값: 부모의 공통 기간(분석할 "현재"). 사용자가 패널에서 직접 바꿔도 됨. */
  initialFrom?: string | null;
  initialTo?: string | null;
}

interface Snapshot {
  currentFrom: string;
  currentTo: string;
  currentDays: number;
  warnings: string[];
}

interface AnalyzeResponse {
  markdown?: string;
  model?: string;
  usage?: {
    promptTokens?: number;
    candidatesTokens?: number;
    totalTokens?: number;
  } | null;
  snapshotMeta?: Snapshot;
  error?: string;
}

function addDays(d: string, delta: number): string {
  const t = Date.parse(d + "T00:00:00Z");
  if (!Number.isFinite(t)) return d;
  return new Date(t + delta * 86_400_000).toISOString().slice(0, 10);
}

export default function AiAnalysisPanel({
  brand,
  minDate,
  maxDate,
  primarySlug,
  nicknames,
  initialFrom,
  initialTo,
}: Props) {
  const [open, setOpen] = useState(false);
  const defaultTo = initialTo ?? maxDate ?? "";
  const defaultFrom =
    initialFrom ?? (defaultTo ? addDays(defaultTo, -6) : minDate ?? "");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [scope, setScope] = useState<"brand" | "campaign">("brand");
  const [comparisonMode, setComparisonMode] = useState<"vs_prev" | "vs_alltime">(
    "vs_prev",
  );
  const [campaign, setCampaign] = useState<string>("");
  const [campaignOptions, setCampaignOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  // 캠페인 드롭다운에 필요한 목록은 사용자가 캠페인 드릴다운 모드를 처음
  // 켤 때 한 번만 가져온다. distinct 엔드포인트는 비용이 작아 한 번 호출이면 충분.
  useEffect(() => {
    if (scope !== "campaign" || !primarySlug || campaignOptions.length > 0) return;
    const abort = new AbortController();
    fetch(`/api/reports/${primarySlug}/distinct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        column: "campaign_name",
        filter: { dateColumn: "date", dateFrom: null, dateTo: null, dimensions: {} },
        limit: 500,
      }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        const vals = ((j.values ?? []) as { value: string | null }[])
          .map((v) => v.value)
          .filter((v): v is string => !!v);
        setCampaignOptions(vals);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [scope, primarySlug, campaignOptions.length]);

  const dropdownCampaigns = useMemo(() => {
    return Array.from(new Set(campaignOptions)).sort();
  }, [campaignOptions]);

  async function run() {
    setError(null);
    setBusy(true);
    setResult(null);
    try {
      if (scope === "campaign" && !campaign) {
        throw new Error("드릴다운하려는 캠페인을 선택하세요.");
      }
      const res = await fetch(
        `/api/brands/${encodeURIComponent(brand)}/ai-analysis`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scope,
            campaign: scope === "campaign" ? campaign : null,
            currentFrom: from || null,
            currentTo: to || null,
            comparisonMode,
          }),
        },
      );
      const j = (await res.json()) as AnalyzeResponse;
      if (!res.ok || !j.markdown) {
        throw new Error(j.error ?? `요청 실패 (${res.status})`);
      }
      setResult(j);
      if (!open) setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border-2 border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-500/[0.06] to-cyan-500/[0.04] shadow-lg shadow-fuchsia-500/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-fuchsia-500/10"
      >
        <Sparkles size={16} className="text-fuchsia-300 shrink-0" />
        <span className="font-bold text-fuchsia-200 text-sm">AI 분석 (Gemini)</span>
        <span className="text-xs text-gray-400 hidden sm:inline">
          {result?.snapshotMeta
            ? `${result.snapshotMeta.currentFrom} ~ ${result.snapshotMeta.currentTo} · ${comparisonMode === "vs_alltime" ? "누적 비교" : "직전 동기간 비교"} 결과`
            : "직전 동기간 / 누적 데이터 중 선택해서 손실·기회·액션 진단"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-gray-300">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 space-y-3 border-t border-fuchsia-500/20">
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="inline-flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">
                분석 기준 시작일
              </span>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded border border-purple-500/30 bg-slate-900 px-2 py-1 text-gray-200 [color-scheme:dark]"
              />
            </label>
            <label className="inline-flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">
                종료일 (이날까지 = 현재)
              </span>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded border border-purple-500/30 bg-slate-900 px-2 py-1 text-gray-200 [color-scheme:dark]"
              />
            </label>
            <div className="inline-flex rounded-md border border-purple-500/30 overflow-hidden">
              {(
                [
                  { v: "brand", label: "브랜드 전체" },
                  { v: "campaign", label: "캠페인 드릴다운" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setScope(o.v)}
                  className={`px-2.5 py-1 transition-colors ${
                    scope === o.v
                      ? "bg-gradient-to-r from-fuchsia-500/30 to-cyan-500/30 text-cyan-200 font-medium"
                      : "bg-slate-800 text-gray-400 hover:text-cyan-300"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div
              className="inline-flex rounded-md border border-purple-500/30 overflow-hidden"
              title="비교 기준: 직전 동기간(W/W) vs 전체 누적 평균 + 월별 추세"
            >
              {(
                [
                  { v: "vs_prev", label: "vs 직전 동기간", hint: "최근 변화 위주" },
                  { v: "vs_alltime", label: "vs 누적 데이터", hint: "장기 추세 + 시즌성" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setComparisonMode(o.v)}
                  title={o.hint}
                  className={`px-2.5 py-1 transition-colors ${
                    comparisonMode === o.v
                      ? "bg-gradient-to-r from-amber-500/30 to-rose-500/30 text-amber-200 font-medium"
                      : "bg-slate-800 text-gray-400 hover:text-amber-300"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {scope === "campaign" && (
              <label className="inline-flex flex-col gap-0.5 min-w-[260px] flex-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">
                  캠페인 (닉네임으로 검색 가능)
                </span>
                <CampaignCombobox
                  options={dropdownCampaigns}
                  nicknames={nicknames}
                  value={campaign}
                  onChange={setCampaign}
                  placeholder="이름 또는 닉네임 검색"
                  className="w-full"
                />
              </label>
            )}
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white font-medium hover:from-fuchsia-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed shadow"
            >
              {busy ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> 분석 중…
                </>
              ) : result ? (
                <>
                  <RefreshCw size={12} /> 다시 분석
                </>
              ) : (
                <>
                  <Sparkles size={12} /> 분석 시작
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}

          {result?.snapshotMeta?.warnings.length ? (
            <div className="text-[11px] text-amber-300/80">
              ⚠ {result.snapshotMeta.warnings.join(" · ")}
            </div>
          ) : null}

          {result?.markdown && (
            <div className="rounded-lg border border-purple-500/20 bg-slate-900/50 p-4">
              <SimpleMarkdown text={result.markdown} />
              <div className="mt-4 pt-2 border-t border-purple-500/10 text-[10px] text-gray-500 flex flex-wrap gap-x-3">
                <span>model: {result.model}</span>
                {result.usage?.totalTokens && (
                  <span>
                    토큰 {result.usage.totalTokens.toLocaleString()} (입력{" "}
                    {result.usage.promptTokens?.toLocaleString() ?? "—"} / 출력{" "}
                    {result.usage.candidatesTokens?.toLocaleString() ?? "—"})
                  </span>
                )}
              </div>
            </div>
          )}

          {!result && !busy && !error && (
            <p className="text-[11px] text-gray-500">
              <strong className="text-gray-300">vs 직전 동기간</strong> 모드는 같은
              길이의 직전 기간(예: 7일 선택 → 직전 7일)과 비교해 최근 변화에 집중합니다.{" "}
              <strong className="text-gray-300">vs 누적 데이터</strong> 모드는 전체
              누적 평균과 월별 추세를 함께 봐서 시즌성/장기 패턴/이상치를 짚습니다.{" "}
              브랜드 전체는 모든 캠페인을 종합해 진단하고, 캠페인 드릴다운은 선택한
              캠페인의 키워드 단위까지 액션을 만들어 냅니다. 모델 호출에 보통 10–30초.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
