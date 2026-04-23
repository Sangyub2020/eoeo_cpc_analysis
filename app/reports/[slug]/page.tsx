"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, BarChart3, Table as TableIcon, ArrowLeft, Trash2, ChevronDown, History } from "lucide-react";
import DataTable from "@/components/reports/DataTable";
import ChartBuilder, { type ChartConfigSnapshot } from "@/components/reports/ChartBuilder";
import ContributionChart from "@/components/reports/ContributionChart";
import RoasChart from "@/components/reports/RoasChart";
import HistoryTab from "@/components/reports/HistoryTab";
import FilterBar from "@/components/reports/FilterBar";
import ViewsBar from "@/components/reports/ViewsBar";
import { emptyFilter, type FilterState } from "@/lib/reports/filter";
import type { ReportColumn, ReportType } from "@/lib/reports/types";
import type { ViewConfig } from "@/lib/reports/view";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Tab = "chart" | "table" | "history";

export default function ReportDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;
  const [deleting, setDeleting] = useState(false);
  const [type, setType] = useState<ReportType | null>(null);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chart");
  const [visibleCols, setVisibleCols] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterState>(emptyFilter());
  const [totalRows, setTotalRows] = useState<number | null>(null);

  const [chartConfig, setChartConfig] = useState<ChartConfigSnapshot | null>(null);
  const [chartInitial, setChartInitial] = useState<Partial<ChartConfigSnapshot> | undefined>(undefined);
  const [chartKey, setChartKey] = useState(0);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const currentViewConfig: ViewConfig = {
    tab,
    chart: chartConfig ?? {
      kind: "line",
      xCol: "",
      yCols: [],
      groupCol: "",
    },
    filter,
    table: { visibleCols },
  };

  function loadView(view: { id: string; config: ViewConfig }) {
    setActiveViewId(view.id);
    const c = view.config ?? ({} as ViewConfig);
    if (c.tab) setTab(c.tab);
    if (c.filter) setFilter(c.filter);
    if (c.table?.visibleCols) setVisibleCols(c.table.visibleCols);
    if (c.chart) {
      setChartInitial(c.chart);
      setChartKey((k) => k + 1);
    }
  }

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/reports/types/${slug}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setType(j.type);
        setColumns(j.columns);
        setVisibleCols((j.columns as ReportColumn[]).map((c) => c.column_name));
        const dc = (j.columns as ReportColumn[]).find(
          (c) => c.data_type === "date" || c.data_type === "timestamp",
        );
        setFilter({
          dateColumn: dc?.column_name ?? null,
          dateFrom: null,
          dateTo: null,
          dimensions: {},
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!slug || !columns.length) return;
    fetch(`/api/reports/${slug}/rows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1 }),
    })
      .then((r) => r.json())
      .then((j) => setTotalRows(j.total == null ? null : Number(j.total)))
      .catch(() => {});
  }, [slug, columns]);

  const [matchedRows, setMatchedRows] = useState<number | null>(null);

  // Shared search-term state for ContributionChart + RoasChart. Ranking is by
  // cumulative cost so both charts agree on the Top-N list. Default visible = top 1.
  const [searchTermsTopN, setSearchTermsTopN] = useState(50);
  const [sharedSearchTerms, setSharedSearchTerms] = useState<
    { value: string; cost: number; sales: number; roas: number | null }[]
  >([]);
  const [sharedHiddenTerms, setSharedHiddenTerms] = useState<Set<string>>(new Set());
  const [sharedTermsLoading, setSharedTermsLoading] = useState(false);

  const termFilterKey = useMemo(() => {
    const dims = { ...(filter.dimensions ?? {}) };
    delete dims["search_term"];
    return JSON.stringify({
      dateColumn: filter.dateColumn,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      dimensions: dims,
    });
  }, [filter]);

  useEffect(() => {
    if (!slug || !columns.length) return;
    const hasSearchTerm = columns.some((c) => c.column_name === "search_term");
    const hasCost = columns.some((c) => c.column_name === "total_cost");
    const hasSales = columns.some((c) => c.column_name === "sales");
    if (!hasSearchTerm || !hasCost || !hasSales) return;

    const abort = new AbortController();
    setSharedTermsLoading(true);

    const dims = { ...(filter.dimensions ?? {}) };
    delete dims["search_term"];
    const baseFilter = { ...filter, dimensions: dims };

    fetch(`/api/reports/${slug}/distinct`, {
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
        const terms = (
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
        setSharedSearchTerms(terms);
        // Default: only the #1 term is visible
        setSharedHiddenTerms(new Set(terms.slice(1).map((t) => t.value)));
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
      })
      .finally(() => setSharedTermsLoading(false));
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, columns.length, searchTermsTopN, termFilterKey]);

  // Parallel state for a second contribution chart grouped by `target_value`
  // (same format as the search-term chart, shown at the bottom of the page).
  const [targetValuesTopN, setTargetValuesTopN] = useState(50);
  const [sharedTargetValues, setSharedTargetValues] = useState<
    { value: string; cost: number; sales: number; roas: number | null }[]
  >([]);
  const [sharedHiddenTargetValues, setSharedHiddenTargetValues] = useState<Set<string>>(new Set());
  const [sharedTargetValuesLoading, setSharedTargetValuesLoading] = useState(false);

  const targetFilterKey = useMemo(() => {
    const dims = { ...(filter.dimensions ?? {}) };
    delete dims["target_value"];
    return JSON.stringify({
      dateColumn: filter.dateColumn,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      dimensions: dims,
    });
  }, [filter]);

  useEffect(() => {
    if (!slug || !columns.length) return;
    const hasTargetValue = columns.some((c) => c.column_name === "target_value");
    const hasCost = columns.some((c) => c.column_name === "total_cost");
    const hasSales = columns.some((c) => c.column_name === "sales");
    if (!hasTargetValue || !hasCost || !hasSales) return;

    const abort = new AbortController();
    setSharedTargetValuesLoading(true);

    const dims = { ...(filter.dimensions ?? {}) };
    delete dims["target_value"];
    const baseFilter = { ...filter, dimensions: dims };

    fetch(`/api/reports/${slug}/distinct`, {
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
        const vals = (
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
        setSharedTargetValues(vals);
        setSharedHiddenTargetValues(new Set(vals.slice(1).map((v) => v.value)));
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
      })
      .finally(() => setSharedTargetValuesLoading(false));
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, columns.length, targetValuesTopN, targetFilterKey]);

  useEffect(() => {
    if (!slug || !columns.length) return;
    const abort = new AbortController();
    fetch(`/api/reports/${slug}/rows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filter, limit: 1 }),
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => setMatchedRows(j.total == null ? null : Number(j.total)))
      .catch((e) => {
        if (e.name === "AbortError") return;
      });
    return () => abort.abort();
  }, [slug, columns, filter]);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/reports/types/${slug}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${j.error ?? res.status}`);
      setDeleting(false);
      return;
    }
    router.push("/reports");
    router.refresh();
  }

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

  if (error || !type) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-auto px-2 py-1">
          <Link href="/reports">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록으로
          </Link>
        </Button>
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            {error ?? "레포트를 찾을 수 없습니다."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 h-auto px-2 py-1 text-muted-foreground">
        <Link href="/reports">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록으로
        </Link>
      </Button>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            {type.display_name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400">
            <Badge variant="secondary" className="font-mono text-[11px]">
              {type.slug}
            </Badge>
            <span>·</span>
            <span>{columns.length}개 열</span>
            {totalRows != null && (
              <>
                <span>·</span>
                <span>{totalRows.toLocaleString()}행</span>
              </>
            )}
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              레포트 삭제
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>레포트를 완전히 삭제합니다</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-medium text-foreground">&quot;{type.display_name}&quot;</span>
                {" "}의 모든 데이터(
                {totalRows?.toLocaleString() ?? "?"}행)와 테이블이 사라지며, 되돌릴 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                {deleting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 삭제 중...
                  </>
                ) : (
                  "삭제"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Separator />

      <FilterBar
        slug={slug}
        columns={columns}
        filter={filter}
        setFilter={setFilter}
        totalRows={totalRows ?? undefined}
        matchedRows={matchedRows ?? undefined}
        hideTextFilters
      />

      <ViewsBar
        baseUrl={`/api/reports/${slug}`}
        activeViewId={activeViewId}
        currentConfig={currentViewConfig}
        onLoad={loadView}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="chart">
            <BarChart3 className="h-3.5 w-3.5" />
            차트
          </TabsTrigger>
          <TabsTrigger value="table">
            <TableIcon className="h-3.5 w-3.5" />
            표
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-3.5 w-3.5" />
            변경 히스토리
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chart" className="space-y-4">
          <ChartBuilder
            key={chartKey}
            slug={slug}
            columns={columns}
            filter={filter}
            setFilter={setFilter}
            initialConfig={chartInitial}
            onConfigChange={setChartConfig}
          />
          <ContributionChart
            slug={slug}
            columns={columns}
            filter={filter}
            topN={searchTermsTopN}
            setTopN={setSearchTermsTopN}
            sharedTerms={sharedSearchTerms}
            hidden={sharedHiddenTerms}
            setHidden={setSharedHiddenTerms}
            termsLoading={sharedTermsLoading}
          />
          <RoasChart
            slug={slug}
            columns={columns}
            filter={filter}
            topN={searchTermsTopN}
            setTopN={setSearchTermsTopN}
            sharedTerms={sharedSearchTerms}
            hidden={sharedHiddenTerms}
            setHidden={setSharedHiddenTerms}
            termsLoading={sharedTermsLoading}
          />
          {columns.some((c) => c.column_name === "target_value") && (
            <ContributionChart
              slug={slug}
              columns={columns}
              filter={filter}
              topN={targetValuesTopN}
              setTopN={setTargetValuesTopN}
              sharedTerms={sharedTargetValues}
              hidden={sharedHiddenTargetValues}
              setHidden={setSharedHiddenTargetValues}
              termsLoading={sharedTargetValuesLoading}
              stackColumn="target_value"
            />
          )}
        </TabsContent>

        <TabsContent value="table" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                <span>
                  표시할 열{" "}
                  <span className="text-muted-foreground font-normal">
                    ({visibleCols.length}/{columns.length})
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <details className="group">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground list-none -mt-2">
                  열 선택 펼치기
                </summary>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  {columns.map((c) => (
                    <label
                      key={c.column_name}
                      className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visibleCols.includes(c.column_name)}
                        onChange={(e) =>
                          setVisibleCols((prev) =>
                            e.target.checked
                              ? [...prev, c.column_name]
                              : prev.filter((x) => x !== c.column_name),
                          )
                        }
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span className="truncate">{c.source_header}</span>
                    </label>
                  ))}
                </div>
              </details>
            </CardContent>
          </Card>
          <DataTable
            slug={slug}
            columns={columns}
            visibleColumns={columns.map((c) => c.column_name).filter((n) => visibleCols.includes(n))}
            filter={filter}
          />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <HistoryTab baseUrl={`/api/reports/${slug}`} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
