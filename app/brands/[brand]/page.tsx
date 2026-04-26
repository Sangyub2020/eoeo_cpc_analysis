"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, FolderOpen, BarChart3, History, Tag, Upload } from "lucide-react";
import ChartBuilder, { type ChartConfigSnapshot } from "@/components/reports/ChartBuilder";
import ContributionChart from "@/components/reports/ContributionChart";
import RoasChart from "@/components/reports/RoasChart";
import DrillDownModal from "@/components/reports/DrillDownModal";
import CampaignLogTab from "@/components/reports/CampaignLogTab";
import NicknamesTab from "@/components/reports/NicknamesTab";
import UploadsTab from "@/components/reports/UploadsTab";
import ViewsBar from "@/components/reports/ViewsBar";
import DateRangeSlider from "@/components/reports/DateRangeSlider";
import { emptyFilter, type FilterState } from "@/lib/reports/filter";
import type { ReportColumn, ReportType } from "@/lib/reports/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

type TypeInfo = {
  type: ReportType;
  columns: ReportColumn[];
  dateRange?: { min: string | null; max: string | null };
};

interface BrandViewConfig {
  tab: "dashboard" | "history" | "nicknames" | "uploads";
  chart: ChartConfigSnapshot | null;
  searchFilter: FilterState;
  targetFilter: FilterState;
  searchTermsTopN: number;
  sharedHiddenTerms: string[];
  targetValuesTopN: number;
  sharedHiddenTargetValues: string[];
}

export default function BrandDetailPage() {
  const params = useParams<{ brand: string }>();
  const brand = decodeURIComponent(params.brand);

  const [types, setTypes] = useState<TypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"dashboard" | "history" | "nicknames" | "uploads">("dashboard");

  /** Drill-down state: when a user clicks 🎯 next to a term in the right
   *  panel, open a modal that queries the raw (sp_raw) table for the
   *  cross-axis breakdown. */
  const [drillState, setDrillState] = useState<{
    filterBy: "search_term" | "target_value";
    groupBy: "search_term" | "target_value";
    value: string;
  } | null>(null);

  /** Brand-scoped campaign_name → nickname map. Loaded from the API, passed
   *  down to ChartBuilder so long Amazon names display as readable aliases. */
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [nicknamesVersion, setNicknamesVersion] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/brands/${encodeURIComponent(brand)}/nicknames`, { signal: abort.signal })
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, string> = {};
        for (const n of (j.nicknames ?? []) as { campaign_name: string; nickname: string }[]) {
          map[n.campaign_name] = n.nickname;
        }
        setNicknames(map);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [brand, nicknamesVersion]);

  // Chart config (kind / X / Y / groupCol) for the top ChartBuilder. Stored
  // here so we can include it in saved views and restore on load.
  const [chartConfig, setChartConfig] = useState<ChartConfigSnapshot | null>(null);
  const [chartInitial, setChartInitial] = useState<Partial<ChartConfigSnapshot> | undefined>(undefined);
  const [chartKey, setChartKey] = useState(0);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/brands/${encodeURIComponent(brand)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setTypes(j.types ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "로드 실패"))
      .finally(() => setLoading(false));
  }, [brand]);

  // A brand can have a "search term" report (has `search_term` column) and/or
  // a "target keyword" report (has `target_value` column). Identify each.
  const searchType = useMemo(
    () => types.find((t) => t.columns.some((c) => c.column_name === "search_term")),
    [types],
  );
  const targetType = useMemo(
    () => types.find((t) => t.columns.some((c) => c.column_name === "target_value")),
    [types],
  );

  // Each report_type gets its own FilterState (date column + dimensions differ
  // per table). We sync date range across them below so the dashboards stay
  // temporally aligned when the user picks a range.
  const [searchFilter, setSearchFilter] = useState<FilterState>(emptyFilter());
  const [targetFilter, setTargetFilter] = useState<FilterState>(emptyFilter());

  // Initialize date columns once types are known.
  useEffect(() => {
    if (!searchType) return;
    const dc = searchType.columns.find(
      (c) => c.data_type === "date" || c.data_type === "timestamp",
    );
    setSearchFilter((f) => ({ ...f, dateColumn: dc?.column_name ?? null }));
  }, [searchType]);
  useEffect(() => {
    if (!targetType) return;
    const dc = targetType.columns.find(
      (c) => c.data_type === "date" || c.data_type === "timestamp",
    );
    setTargetFilter((f) => ({ ...f, dateColumn: dc?.column_name ?? null }));
  }, [targetType]);

  // "Shared" date range — editing one filter's date pushes to the other so
  // both charts respect the same date window.
  function setSharedDate(kind: "from" | "to", val: string | null) {
    setSearchFilter((f) => ({ ...f, [kind === "from" ? "dateFrom" : "dateTo"]: val }));
    setTargetFilter((f) => ({ ...f, [kind === "from" ? "dateFrom" : "dateTo"]: val }));
  }

  /** Earliest/latest date across all report types under this brand. Used as
   *  the bounds for the date-range slider so the handles can only slide
   *  within dates the data actually covers. */
  const brandDateBounds = useMemo((): { min: string; max: string } | null => {
    let min: string | null = null;
    let max: string | null = null;
    for (const t of types) {
      const r = t.dateRange;
      if (r?.min && (min === null || r.min < min)) min = r.min;
      if (r?.max && (max === null || r.max > max)) max = r.max;
    }
    return min && max ? { min, max } : null;
  }, [types]);

  /** Dimension columns that exist in BOTH tables — these should stay synced
   *  when the top ChartBuilder edits the primary filter, so the Target value
   *  section respects the campaign selection made up there. */
  const sharedDimNames = useMemo(() => {
    if (!searchType || !targetType) return [] as string[];
    const s = new Set(searchType.columns.map((c) => c.column_name));
    return targetType.columns
      .filter((c) => c.data_type === "text" && s.has(c.column_name))
      .map((c) => c.column_name);
  }, [searchType, targetType]);

  /** Which type drives the top ChartBuilder. Prefer search (finer grain). */
  const primary = searchType ?? targetType;
  const primaryIsSearch = !!primary && primary === searchType;
  const primaryFilter = primaryIsSearch ? searchFilter : targetFilter;

  /** Update the primary filter AND mirror every shared piece (date range +
   *  overlapping dims like campaign_name) into the secondary filter so the
   *  Target value section also obeys the top ChartBuilder's selections. */
  function setPrimaryFilterSynced(next: FilterState) {
    if (primaryIsSearch) setSearchFilter(next);
    else setTargetFilter(next);

    const otherType = primaryIsSearch ? targetType : searchType;
    const otherSetter = primaryIsSearch ? setTargetFilter : setSearchFilter;
    if (!otherType) return;
    otherSetter((prev) => {
      const mergedDims: Record<string, string[]> = { ...(prev.dimensions ?? {}) };
      for (const d of sharedDimNames) {
        const v = next.dimensions?.[d];
        if (v && v.length > 0) mergedDims[d] = v;
        else delete mergedDims[d];
      }
      return {
        ...prev,
        dateFrom: next.dateFrom,
        dateTo: next.dateTo,
        dimensions: mergedDims,
      };
    });
  }

  // Search-term charts: shared topN / hidden state
  const [searchTermsTopN, setSearchTermsTopN] = useState(50);
  const [sharedSearchTerms, setSharedSearchTerms] = useState<
    { value: string; cost: number; sales: number; roas: number | null }[]
  >([]);
  const [sharedHiddenTerms, setSharedHiddenTerms] = useState<Set<string>>(new Set());
  const [sharedTermsLoading, setSharedTermsLoading] = useState(false);
  /** The searchTermFilterKey that the current hidden set is "valid for".
   *  When the filter changes (e.g. a new campaign is selected) this ref
   *  no longer matches, so the next distinct fetch resets hidden back to
   *  "only top-1 visible" — giving each campaign selection its own default.
   *  User checkbox toggles + Recent-view restores update this ref so
   *  manual selections survive topN refetches on the same filter state. */
  const hiddenTermsOwnedKeyRef = useRef<string | null>(null);

  // Target-value chart: shared topN / hidden state
  const [targetValuesTopN, setTargetValuesTopN] = useState(50);
  const [sharedTargetValues, setSharedTargetValues] = useState<
    { value: string; cost: number; sales: number; roas: number | null }[]
  >([]);
  const [sharedHiddenTargetValues, setSharedHiddenTargetValues] = useState<Set<string>>(
    new Set(),
  );
  const [sharedTargetValuesLoading, setSharedTargetValuesLoading] = useState(false);
  const hiddenTargetsOwnedKeyRef = useRef<string | null>(null);

  // Stable key so the distinct fetch only reruns on the pieces of the filter
  // that actually affect the list (date range; everything except search_term).
  const searchTermFilterKey = useMemo(() => {
    const dims = { ...(searchFilter.dimensions ?? {}) };
    delete dims["search_term"];
    return JSON.stringify({
      dateColumn: searchFilter.dateColumn,
      dateFrom: searchFilter.dateFrom,
      dateTo: searchFilter.dateTo,
      dimensions: dims,
    });
  }, [searchFilter]);

  const targetValueFilterKey = useMemo(() => {
    const dims = { ...(targetFilter.dimensions ?? {}) };
    delete dims["target_value"];
    return JSON.stringify({
      dateColumn: targetFilter.dateColumn,
      dateFrom: targetFilter.dateFrom,
      dateTo: targetFilter.dateTo,
      dimensions: dims,
    });
  }, [targetFilter]);

  // Setters that mark the current hidden set as "owned" by the current filter
  // key, so subsequent topN refetches don't trample the user's selection but
  // a filter change does force a default-top-1 reset. Pass these to children
  // instead of the raw setters.
  function setHiddenTermsOwned(next: Set<string>) {
    hiddenTermsOwnedKeyRef.current = searchTermFilterKey;
    setSharedHiddenTerms(next);
  }
  function setHiddenTargetsOwned(next: Set<string>) {
    hiddenTargetsOwnedKeyRef.current = targetValueFilterKey;
    setSharedHiddenTargetValues(next);
  }

  useEffect(() => {
    if (!searchType) return;
    const abort = new AbortController();
    setSharedTermsLoading(true);
    const dims = { ...(searchFilter.dimensions ?? {}) };
    delete dims["search_term"];
    const baseFilter = { ...searchFilter, dimensions: dims };
    fetch(`/api/reports/${searchType.type.slug}/distinct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        column: "search_term",
        filter: baseFilter,
        limit: searchTermsTopN,
        metric: { col: "total_cost", fn: "sum" },
        extraMetrics: [{ col: "sales", fn: "sum" }],
      }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        const terms = ((j.values ?? []) as { value: string | null; metric?: number; e0?: number }[])
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
        setSharedSearchTerms(terms);
        // Only default to "top-1 visible" when the hidden set was never
        // owned against the current filter state (fresh load, or filter
        // just changed — e.g. user picked a different campaign).
        if (hiddenTermsOwnedKeyRef.current !== searchTermFilterKey) {
          setSharedHiddenTerms(new Set(terms.slice(1).map((t) => t.value)));
          hiddenTermsOwnedKeyRef.current = null;
        }
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
      })
      .finally(() => setSharedTermsLoading(false));
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchType?.type.slug, searchTermsTopN, searchTermFilterKey]);

  useEffect(() => {
    if (!targetType) return;
    const abort = new AbortController();
    setSharedTargetValuesLoading(true);
    const dims = { ...(targetFilter.dimensions ?? {}) };
    delete dims["target_value"];
    const baseFilter = { ...targetFilter, dimensions: dims };
    fetch(`/api/reports/${targetType.type.slug}/distinct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        column: "target_value",
        filter: baseFilter,
        limit: targetValuesTopN,
        metric: { col: "total_cost", fn: "sum" },
        extraMetrics: [{ col: "sales", fn: "sum" }],
      }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        const vals = ((j.values ?? []) as { value: string | null; metric?: number; e0?: number }[])
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
        setSharedTargetValues(vals);
        if (hiddenTargetsOwnedKeyRef.current !== targetValueFilterKey) {
          setSharedHiddenTargetValues(new Set(vals.slice(1).map((v) => v.value)));
          hiddenTargetsOwnedKeyRef.current = null;
        }
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
      })
      .finally(() => setSharedTargetValuesLoading(false));
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType?.type.slug, targetValuesTopN, targetValueFilterKey]);

  // Snapshot of the current dashboard state — serialized into saved views.
  const currentViewConfig: BrandViewConfig = useMemo(
    () => ({
      tab,
      chart: chartConfig,
      searchFilter,
      targetFilter,
      searchTermsTopN,
      sharedHiddenTerms: Array.from(sharedHiddenTerms),
      targetValuesTopN,
      sharedHiddenTargetValues: Array.from(sharedHiddenTargetValues),
    }),
    [
      tab,
      chartConfig,
      searchFilter,
      targetFilter,
      searchTermsTopN,
      sharedHiddenTerms,
      targetValuesTopN,
      sharedHiddenTargetValues,
    ],
  );

  function loadView(view: { id: string; config: BrandViewConfig }) {
    setActiveViewId(view.id);
    const c = view.config ?? ({} as BrandViewConfig);
    if (c.tab) setTab(c.tab);
    // Preserve the live dateColumn (set after types load) so a Recent view
    // saved before types resolved doesn't blank out the date filter.
    if (c.searchFilter) {
      setSearchFilter((prev) => ({
        ...prev,
        dateColumn: c.searchFilter.dateColumn ?? prev.dateColumn,
        dateFrom: c.searchFilter.dateFrom ?? null,
        dateTo: c.searchFilter.dateTo ?? null,
        dimensions: c.searchFilter.dimensions ?? {},
      }));
    }
    if (c.targetFilter) {
      setTargetFilter((prev) => ({
        ...prev,
        dateColumn: c.targetFilter.dateColumn ?? prev.dateColumn,
        dateFrom: c.targetFilter.dateFrom ?? null,
        dateTo: c.targetFilter.dateTo ?? null,
        dimensions: c.targetFilter.dimensions ?? {},
      }));
    }
    if (typeof c.searchTermsTopN === "number") setSearchTermsTopN(c.searchTermsTopN);
    if (Array.isArray(c.sharedHiddenTerms)) {
      // Tag the hidden set as "owned" by the filter key it was saved against
      // so the subsequent distinct-fetch triggered by the filter change sees
      // a matching key and keeps the restored selection.
      if (c.searchFilter) {
        const dims = { ...(c.searchFilter.dimensions ?? {}) };
        delete dims["search_term"];
        hiddenTermsOwnedKeyRef.current = JSON.stringify({
          dateColumn: c.searchFilter.dateColumn,
          dateFrom: c.searchFilter.dateFrom,
          dateTo: c.searchFilter.dateTo,
          dimensions: dims,
        });
      }
      setSharedHiddenTerms(new Set(c.sharedHiddenTerms));
    }
    if (typeof c.targetValuesTopN === "number") setTargetValuesTopN(c.targetValuesTopN);
    if (Array.isArray(c.sharedHiddenTargetValues)) {
      if (c.targetFilter) {
        const dims = { ...(c.targetFilter.dimensions ?? {}) };
        delete dims["target_value"];
        hiddenTargetsOwnedKeyRef.current = JSON.stringify({
          dateColumn: c.targetFilter.dateColumn,
          dateFrom: c.targetFilter.dateFrom,
          dateTo: c.targetFilter.dateTo,
          dimensions: dims,
        });
      }
      setSharedHiddenTargetValues(new Set(c.sharedHiddenTargetValues));
    }
    if (c.chart) {
      setChartInitial(c.chart);
      setChartKey((k) => k + 1);
    }
  }

  // --- Recent view: auto-restore on mount (after types load) + auto-save on unload.
  const RECENT_VIEW_NAME = "Recent";
  const recentRestoredRef = useRef(false);
  const currentConfigRef = useRef<BrandViewConfig | null>(null);
  useEffect(() => {
    currentConfigRef.current = currentViewConfig;
  }, [currentViewConfig]);

  useEffect(() => {
    if (recentRestoredRef.current) return;
    if (types.length === 0) return; // wait until brand types are loaded
    recentRestoredRef.current = true;
    const abort = new AbortController();
    fetch(`/api/brands/${encodeURIComponent(brand)}/views`, {
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        const recent = ((j.views ?? []) as { id: string; name: string; config: BrandViewConfig }[])
          .find((v) => v.name === RECENT_VIEW_NAME);
        if (recent) loadView(recent);
      })
      .catch(() => {});
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types, brand]);

  // Save-on-leave: fires for intra-app nav (effect cleanup) and real tab
  // unload (pagehide). Uses sendBeacon for unload because fetch() is not
  // guaranteed to complete once the page is tearing down.
  useEffect(() => {
    const url = `/api/brands/${encodeURIComponent(brand)}/views/recent`;
    const save = (useBeacon: boolean) => {
      const cfg = currentConfigRef.current;
      if (!cfg) return;
      const payload = JSON.stringify({ config: cfg });
      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    };
    const onPageHide = () => save(true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      save(false);
    };
  }, [brand]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-24" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-[440px] w-full" />
      </div>
    );
  }

  if (error || types.length === 0) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-auto px-2 py-1">
          <Link href="/reports">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록으로
          </Link>
        </Button>
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            {error ?? `브랜드 "${brand}"에 등록된 레포트가 없습니다.`}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button asChild variant="ghost" size="sm" className="-ml-2 h-auto px-2 py-0.5 text-muted-foreground">
        <Link href="/reports">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록으로
        </Link>
      </Button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent inline-flex items-center gap-2">
            <FolderOpen className="text-cyan-300" size={22} />
            {brand}
          </h1>
          <div className="text-xs text-gray-400">
            {types.length}개 레포트 포함:{" "}
            {types.map((t, i) => (
              <span key={t.type.slug}>
                <Link
                  href={`/reports/${t.type.slug}`}
                  className="text-cyan-300 underline-offset-4 hover:underline"
                >
                  {t.type.display_name}
                </Link>
                {i < types.length - 1 && <span className="text-gray-600"> · </span>}
              </span>
            ))}
            {brandDateBounds && (
              <span className="ml-2 text-gray-500">
                · 데이터 범위{" "}
                <span className="font-mono text-gray-400">
                  {brandDateBounds.min} ~ {brandDateBounds.max}
                </span>
              </span>
            )}
          </div>
        </div>
        <Link
          href={`/upload?continue=1&brand=${encodeURIComponent(brand)}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 text-sm text-cyan-200 hover:bg-cyan-500/20 hover:border-cyan-500/60 whitespace-nowrap"
          title="현재까지 업로드된 시점 이후 데이터만 추가합니다"
        >
          <Upload size={14} /> 이어서 업로드
        </Link>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="dashboard">
            <BarChart3 className="h-3.5 w-3.5" /> 대시보드
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-3.5 w-3.5" /> 캠페인 수정일지
          </TabsTrigger>
          {primary && (
            <TabsTrigger value="nicknames">
              <Tag className="h-3.5 w-3.5" /> 캠페인 닉네임
            </TabsTrigger>
          )}
          <TabsTrigger value="uploads">
            <Upload className="h-3.5 w-3.5" /> 업로드 관리
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          {/* Shared date range — only date is synced; dimension filters stay
              per-type because column sets differ between the two tables.
              Sticky to the top of the viewport (below the global app header)
              so the date window stays visible while scrolling through long
              charts. `top-14` matches the app header height. */}
          <div className="sticky top-14 z-20 -mx-2 px-2 bg-slate-900/85 backdrop-blur-xl py-1 rounded-b-lg shadow-md shadow-slate-950/40">
            <div className="px-2.5 py-1.5 rounded-md border border-purple-500/20 bg-slate-800/60 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[11px] font-medium text-gray-300 shrink-0">공통 기간</span>
              <label className="inline-flex items-center gap-1 text-gray-400 shrink-0">
                <input
                  type="date"
                  min={brandDateBounds?.min ?? undefined}
                  max={brandDateBounds?.max ?? undefined}
                  value={searchFilter.dateFrom ?? targetFilter.dateFrom ?? ""}
                  onChange={(e) => setSharedDate("from", e.target.value || null)}
                  className="rounded border border-purple-500/30 bg-slate-900 px-1.5 py-0.5 text-[11px] text-gray-200 focus:border-cyan-500 focus:outline-none [color-scheme:dark]"
                />
                <span className="text-gray-500">~</span>
                <input
                  type="date"
                  min={brandDateBounds?.min ?? undefined}
                  max={brandDateBounds?.max ?? undefined}
                  value={searchFilter.dateTo ?? targetFilter.dateTo ?? ""}
                  onChange={(e) => setSharedDate("to", e.target.value || null)}
                  className="rounded border border-purple-500/30 bg-slate-900 px-1.5 py-0.5 text-[11px] text-gray-200 focus:border-cyan-500 focus:outline-none [color-scheme:dark]"
                />
              </label>
              {brandDateBounds && (
                <div className="flex-1 min-w-[200px] max-w-[640px]">
                  <DateRangeSlider
                    minDate={brandDateBounds.min}
                    maxDate={brandDateBounds.max}
                    fromDate={searchFilter.dateFrom ?? targetFilter.dateFrom ?? null}
                    toDate={searchFilter.dateTo ?? targetFilter.dateTo ?? null}
                    onChange={(from, to) => {
                      setSearchFilter((f) => ({ ...f, dateFrom: from, dateTo: to }));
                      setTargetFilter((f) => ({ ...f, dateFrom: from, dateTo: to }));
                    }}
                  />
                </div>
              )}
              {(sharedTermsLoading || sharedTargetValuesLoading) && (
                <Loader2 size={12} className="animate-spin text-cyan-400 shrink-0" />
              )}
            </div>
          </div>

          <ViewsBar
            baseUrl={`/api/brands/${encodeURIComponent(brand)}`}
            activeViewId={activeViewId}
            currentConfig={currentViewConfig}
            onLoad={loadView}
          />

          {/* One ChartBuilder at the top — it drives kind/X/Y/group for the
              brand. Uses the search-term table as its source (finer grain, has
              search_term / campaign_name dimensions). Its filter changes are
              mirrored into the target-value filter for any shared dimension
              (campaign_name, date) so the Target value section obeys the same
              campaign/period selection. */}
          {primary && (
            <ChartBuilder
              key={chartKey}
              slug={primary.type.slug}
              columns={primary.columns}
              filter={primaryFilter}
              setFilter={setPrimaryFilterSynced}
              initialConfig={chartInitial}
              onConfigChange={setChartConfig}
              nicknames={nicknames}
            />
          )}

          {/* SEARCH TERM SECTION — Contribution + ROAS */}
          {searchType && (
            <section className="relative rounded-xl border-2 border-cyan-500/40 bg-cyan-500/[0.03] pt-6 px-4 pb-4 mt-3 space-y-3 shadow-lg shadow-cyan-500/5">
              <span className="absolute -top-3.5 left-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-cyan-500 text-slate-950 text-sm font-bold uppercase tracking-wide shadow-lg shadow-cyan-500/40">
                Search Term <span className="normal-case">분석</span>
              </span>
              <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 border-b border-cyan-500/20 pb-2">
                <SelectedCampaignBadge
                  campaigns={searchFilter.dimensions?.campaign_name ?? []}
                  nicknames={nicknames}
                />
                <span className="text-xs text-gray-500">
                  <Link
                    href={`/reports/${searchType.type.slug}`}
                    className="hover:text-cyan-300"
                  >
                    → {searchType.type.display_name}
                  </Link>
                </span>
              </div>
              <ContributionChart
                slug={searchType.type.slug}
                columns={searchType.columns}
                filter={searchFilter}
                topN={searchTermsTopN}
                setTopN={setSearchTermsTopN}
                sharedTerms={sharedSearchTerms}
                hidden={sharedHiddenTerms}
                setHidden={setHiddenTermsOwned}
                termsLoading={sharedTermsLoading}
                stackColumn="search_term"
                onDrill={(v) =>
                  setDrillState({
                    filterBy: "search_term",
                    groupBy: "target_value",
                    value: v,
                  })
                }
              />
              <RoasChart
                slug={searchType.type.slug}
                columns={searchType.columns}
                filter={searchFilter}
                topN={searchTermsTopN}
                setTopN={setSearchTermsTopN}
                sharedTerms={sharedSearchTerms}
                hidden={sharedHiddenTerms}
                setHidden={setHiddenTermsOwned}
                termsLoading={sharedTermsLoading}
                onDrill={(v) =>
                  setDrillState({
                    filterBy: "search_term",
                    groupBy: "target_value",
                    value: v,
                  })
                }
              />
            </section>
          )}

          {/* TARGET VALUE SECTION — Contribution only */}
          {targetType && (
            <section className="relative rounded-xl border-2 border-purple-500/40 bg-purple-500/[0.03] pt-6 px-4 pb-4 mt-3 space-y-3 shadow-lg shadow-purple-500/5">
              <span className="absolute -top-3.5 left-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-purple-500 text-slate-950 text-sm font-bold uppercase tracking-wide shadow-lg shadow-purple-500/40">
                Target Keyword <span className="normal-case">분석</span>
              </span>
              <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 border-b border-purple-500/20 pb-2">
                <SelectedCampaignBadge
                  campaigns={targetFilter.dimensions?.campaign_name ?? []}
                  nicknames={nicknames}
                />
                <span className="text-xs text-gray-500">
                  <Link
                    href={`/reports/${targetType.type.slug}`}
                    className="hover:text-cyan-300"
                  >
                    → {targetType.type.display_name}
                  </Link>
                </span>
              </div>
              <ContributionChart
                slug={targetType.type.slug}
                columns={targetType.columns}
                filter={targetFilter}
                topN={targetValuesTopN}
                setTopN={setTargetValuesTopN}
                sharedTerms={sharedTargetValues}
                hidden={sharedHiddenTargetValues}
                setHidden={setHiddenTargetsOwned}
                termsLoading={sharedTargetValuesLoading}
                stackColumn="target_value"
                onDrill={(v) =>
                  setDrillState({
                    filterBy: "target_value",
                    groupBy: "search_term",
                    value: v,
                  })
                }
              />
              <RoasChart
                slug={targetType.type.slug}
                columns={targetType.columns}
                filter={targetFilter}
                topN={targetValuesTopN}
                setTopN={setTargetValuesTopN}
                sharedTerms={sharedTargetValues}
                hidden={sharedHiddenTargetValues}
                setHidden={setHiddenTargetsOwned}
                termsLoading={sharedTargetValuesLoading}
                stackColumn="target_value"
                onDrill={(v) =>
                  setDrillState({
                    filterBy: "target_value",
                    groupBy: "search_term",
                    value: v,
                  })
                }
              />
            </section>
          )}

          {/* Fallback: any other report_types under this brand that don't
              match the search/target shape — link to their individual pages. */}
          {types
            .filter(
              (t) =>
                t.type.slug !== searchType?.type.slug &&
                t.type.slug !== targetType?.type.slug,
            )
            .map((t) => (
              <Card key={t.type.slug}>
                <CardContent className="py-4 text-sm text-gray-400">
                  이 브랜드 안에 추가된 레포트:{" "}
                  <Link
                    href={`/reports/${t.type.slug}`}
                    className="text-cyan-300 underline-offset-4 hover:underline"
                  >
                    {t.type.display_name}
                  </Link>
                </CardContent>
              </Card>
            ))}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {primary ? (
            <CampaignLogTab
              baseUrl={`/api/brands/${encodeURIComponent(brand)}`}
              brand={brand}
              primarySlug={primary.type.slug}
              nicknames={nicknames}
            />
          ) : (
            <div className="p-6 text-sm text-gray-500">
              이 브랜드에 레포트가 없어 캠페인 수정일지를 표시할 수 없습니다.
            </div>
          )}
        </TabsContent>

        {primary && (
          <TabsContent value="nicknames" className="space-y-4">
            <NicknamesTab
              brand={brand}
              primarySlug={primary.type.slug}
              onChanged={() => setNicknamesVersion((v) => v + 1)}
            />
          </TabsContent>
        )}

        <TabsContent value="uploads" className="space-y-4">
          <UploadsTab brand={brand} />
        </TabsContent>
      </Tabs>

      {drillState && (
        <DrillDownModal
          brand={brand}
          filterBy={drillState.filterBy}
          value={drillState.value}
          groupBy={drillState.groupBy}
          filter={primaryFilter}
          onClose={() => setDrillState(null)}
        />
      )}
    </div>
  );
}

/** Inline badge shown next to each section title. Reads the currently-selected
 *  campaigns from the filter and renders `이름 (닉네임) 외 N-1개` style. */
function SelectedCampaignBadge({
  campaigns,
  nicknames,
}: {
  campaigns: string[];
  nicknames: Record<string, string>;
}) {
  if (!campaigns.length) {
    return (
      <span className="text-xs text-gray-500 italic">
        선택된 캠페인 없음 (전체)
      </span>
    );
  }
  const first = campaigns[0];
  const firstNick = nicknames[first];
  const extra = campaigns.length - 1;
  return (
    <span className="inline-flex items-baseline gap-1.5 text-xs max-w-[720px] truncate">
      <span
        className="text-gray-200 font-medium font-mono truncate"
        title={first}
      >
        {first}
      </span>
      {firstNick && (
        <span className="text-cyan-300" title={`닉네임: ${firstNick}`}>
          ({firstNick})
        </span>
      )}
      {extra > 0 && (
        <span
          className="text-cyan-300 font-medium"
          title={campaigns.slice(1).join("\n")}
        >
          외 {extra}개
        </span>
      )}
    </span>
  );
}
