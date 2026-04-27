"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Tags,
} from "lucide-react";
import FileDrop from "@/components/upload/FileDrop";
import HeaderRowPicker from "@/components/upload/HeaderRowPicker";
import BrandAssignmentTable from "@/components/upload/BrandAssignmentTable";
import { parseSpreadsheet } from "@/lib/reports/parse";
import {
  compileRules,
  matchBrand,
  type Brand,
  type BrandRule,
} from "@/lib/brands/match";
import {
  ALL_KINDS,
  buildPlanForKind,
  type KindColumn,
  type KindSchema,
} from "@/lib/reports/report-kinds";
import type {
  DataType,
  HeaderPlan,
  ReportColumn,
  ReportType,
} from "@/lib/reports/types";

type Step = "pick" | "kind" | "assign" | "committing" | "done";

// Tuned for INSERT into wide tables with multiple indexes (e.g. sp_raw).
// Smaller chunks finish well below any statement_timeout, lower parallel
// count keeps index-page lock contention bounded — empirically faster
// than fewer-bigger-chunks at higher parallelism on multi-million-row
// destinations.
const CHUNK_SIZE = 2000;
const CHUNK_PARALLEL = 4;
const CHUNK_SIZE_STREAMING = 1500;
const CHUNK_PARALLEL_STREAMING = 3;
const LARGE_CSV_THRESHOLD = 100 * 1024 * 1024;
const PREVIEW_SLICE_BYTES = 1 * 1024 * 1024;

const CAMPAIGN_COL = "campaign_name";

function isCsvFile(f: File): boolean {
  return f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv";
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GB";
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}

interface BeginResponse {
  upload_id: string;
  report_type_id: string;
  slug: string;
  tableName: string;
  columnNames: string[];
  sourceHeaders: string[];
  dataTypes: DataType[];
  keyColumns: string[];
  /** Max date already present in the destination table. Null for new types
   *  or tables without a date column. The continuation flow uses this to
   *  skip rows the table already has. */
  latestDate?: string | null;
}

interface CampaignStat {
  campaign_name: string;
  row_count: number;
  auto_brand_slug: string | null;
  auto_rule_pattern: string | null;
}

export default function UploadPageWrapper() {
  // Suspense boundary — useSearchParams() inside requires it for the build's
  // static-prerender pass to succeed.
  return (
    <Suspense fallback={null}>
      <UploadPage />
    </Suspense>
  );
}

function UploadPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /** When `?continue=1` is in the URL, the upload skips rows whose date is
   *  on or before the destination table's existing max date — for the brand
   *  detail page's "이어서 업로드" entry point. */
  const continueMode = searchParams?.get("continue") === "1";
  const continueBrand = searchParams?.get("brand") ?? null;
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [previewRows, setPreviewRows] = useState<unknown[][]>([]);
  const [headerRowIdx, setHeaderRowIdx] = useState(0);
  const [largeCsvMode, setLargeCsvMode] = useState(false);
  const [fileQueue, setFileQueue] = useState<File[]>([]);

  const [existingTypes, setExistingTypes] = useState<ReportType[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [rules, setRules] = useState<BrandRule[]>([]);
  const compiledRules = useMemo(
    () => compileRules(brands, rules),
    [brands, rules],
  );

  const [selectedKind, setSelectedKind] = useState<string>("");
  const [isNewKind, setIsNewKind] = useState(false);
  const [newKindSlug, setNewKindSlug] = useState("");
  const [newKindDisplayName, setNewKindDisplayName] = useState("");
  const [existingColumns, setExistingColumns] = useState<ReportColumn[]>([]);

  const [plan, setPlan] = useState<HeaderPlan[]>([]);
  const [campaignStats, setCampaignStats] = useState<CampaignStat[]>([]);
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [scanningCampaigns, setScanningCampaigns] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, stage: "" });
  const [resultBrands, setResultBrands] = useState<
    {
      slug: string;
      display_name: string;
      rows: number;
      minDate: string | null;
      maxDate: string | null;
    }[]
  >([]);
  const [resultSkipped, setResultSkipped] = useState<number>(0);
  /** When the user picks a kind whose schema can't be matched against the
   *  uploaded headers, we surface a structured Dimension/Metric list so the
   *  user sees exactly what's missing — friendlier than a single-line error. */
  const [schemaError, setSchemaError] = useState<{
    schema: KindSchema;
    missing: KindColumn[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/reports/types")
      .then((r) => r.json())
      .then((j) => setExistingTypes(j.types ?? []))
      .catch(() => {});
    fetch("/api/brands/catalog")
      .then((r) => r.json())
      .then((j) => {
        setBrands(j.brands ?? []);
        setRules(j.rules ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (step !== "committing") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [step]);

  async function handleFile(f: File) {
    setError(null);
    setFile(f);
    try {
      const large = f.size > LARGE_CSV_THRESHOLD && isCsvFile(f);
      if (f.size > LARGE_CSV_THRESHOLD && !isCsvFile(f)) {
        setError(
          `${fmtBytes(f.size)} 파일은 메모리에 올리기 너무 큽니다. xlsx는 스트리밍을 지원하지 않으니 CSV로 변환 후 업로드하세요.`,
        );
        return;
      }
      setLargeCsvMode(large);

      const blob = large ? f.slice(0, PREVIEW_SLICE_BYTES) : f;
      const buf = await blob.arrayBuffer();
      const parsed = parseSpreadsheet(buf);
      if (!parsed.headers.length) {
        setError("헤더를 찾지 못했습니다. 빈 시트인가요?");
        return;
      }
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setPreviewRows(parsed.previewRows);
      setHeaderRowIdx(parsed.headerRowIndex);

      // User picks the report kind manually on the next step. No auto-detection.
      setStep("kind");
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일 파싱 실패");
    }
  }

  /** User picked a kind — build the HeaderPlan from the fixed schema and
   *  proceed straight to brand assignment. Skip the column-mapping step
   *  entirely since Amazon always emits the same columns per kind. */
  async function pickKindSchema(schema: KindSchema) {
    setError(null);
    setSchemaError(null);
    const { plan: builtPlan, missing } = buildPlanForKind(schema, headers);
    if (missing.length > 0) {
      setSchemaError({ schema, missing });
      return;
    }
    setSelectedKind(schema.slug);

    // Check whether this kind already has a stored report_type (any brand).
    const existing = existingTypes.find((t) => t.kind === schema.slug);
    if (existing) {
      setIsNewKind(false);
      const res = await fetch(`/api/reports/types/${existing.slug}`);
      if (!res.ok) {
        setError("레포트 타입 조회 실패");
        return;
      }
      const json = (await res.json()) as {
        type: ReportType;
        columns: ReportColumn[];
      };
      setExistingColumns(json.columns);
      // Adjust is_new on the plan by checking against existing schema.
      const existingCols = new Set(json.columns.map((c) => c.column_name));
      setPlan(
        builtPlan.map((h) => ({ ...h, is_new: !existingCols.has(h.column_name) })),
      );
    } else {
      setIsNewKind(true);
      setNewKindSlug(schema.slug);
      setNewKindDisplayName(schema.display_name);
      setExistingColumns([]);
      setPlan(builtPlan);
    }

    // Campaign source header lives in the plan we just built — pass it
    // explicitly since React state hasn't re-run the memo yet.
    const campaignEntry = builtPlan.find((h) => h.column_name === CAMPAIGN_COL);
    if (!campaignEntry) {
      setError(`선택한 레포트 종류에 \`${CAMPAIGN_COL}\` 매핑이 없습니다.`);
      return;
    }
    await goToAssign(campaignEntry.source_header);
  }

  const reparseWithHeaderRow = useCallback(
    async (newIdx: number) => {
      if (!file) return;
      setError(null);
      try {
        const blob = largeCsvMode ? file.slice(0, PREVIEW_SLICE_BYTES) : file;
        const buf = await blob.arrayBuffer();
        const parsed = parseSpreadsheet(buf, newIdx);
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        setPreviewRows(parsed.previewRows);
        setHeaderRowIdx(parsed.headerRowIndex);
      } catch (e) {
        setError(e instanceof Error ? e.message : "재파싱 실패");
      }
    },
    [file, largeCsvMode],
  );

  const campaignSourceHeader = useMemo(() => {
    const entry = plan.find((h) => h.include && h.column_name === CAMPAIGN_COL);
    return entry?.source_header ?? null;
  }, [plan]);

  /** Called both from the (now-removed) map step and immediately after the
   *  user picks a kind. `explicitCampaignHeader` lets `pickKindSchema` pass
   *  the source header directly without waiting for React to re-run the
   *  `campaignSourceHeader` memo. */
  async function goToAssign(explicitCampaignHeader?: string) {
    const sourceHeader = explicitCampaignHeader ?? campaignSourceHeader;
    if (!sourceHeader) {
      setError(
        `업로드에는 \`${CAMPAIGN_COL}\` 컬럼이 필요합니다.`,
      );
      return;
    }
    if (brands.length === 0) {
      setError(
        "등록된 브랜드가 없습니다. /brands/manage 에서 최소 1개 브랜드를 추가하세요.",
      );
      return;
    }
    setError(null);

    let stats: CampaignStat[];
    if (largeCsvMode && file) {
      setScanningCampaigns(true);
      setProgress({ done: 0, total: 0, stage: "캠페인 스캔 중" });
      try {
        stats = await scanCampaignsStreaming(
          file,
          headerRowIdx,
          headers,
          sourceHeader,
          (bytesCursor, totalBytes) => {
            setProgress({
              done: 0,
              total: 0,
              stage: `캠페인 스캔 ${Math.min(
                100,
                Math.round((bytesCursor / totalBytes) * 100),
              )}%`,
            });
          },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "캠페인 스캔 실패");
        setScanningCampaigns(false);
        return;
      } finally {
        setScanningCampaigns(false);
      }
    } else {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const v = r[sourceHeader];
        const name = v == null ? "" : String(v);
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      stats = Array.from(counts.entries()).map(([n, c]) => ({
        campaign_name: n,
        row_count: c,
        auto_brand_slug: null,
        auto_rule_pattern: null,
      }));
    }

    const auto = new Map<string, string>();
    for (const s of stats) {
      const hit = matchBrand(s.campaign_name, compiledRules);
      if (hit) {
        s.auto_brand_slug = hit.brand_slug;
        s.auto_rule_pattern = `${hit.match_type}: ${hit.pattern}`;
        auto.set(s.campaign_name, hit.brand_slug);
      } else {
        auto.set(s.campaign_name, "");
      }
    }
    stats.sort((a, b) => b.row_count - a.row_count);
    setCampaignStats(stats);
    setAssignments(auto);
    setStep("assign");
  }

  async function commit() {
    if (!file) return;
    setError(null);

    const brandToCampaigns = new Map<string, Set<string>>();
    let unassigned = 0;
    for (const s of campaignStats) {
      const b = assignments.get(s.campaign_name) || "";
      if (!b) {
        unassigned++;
        continue;
      }
      const set = brandToCampaigns.get(b) ?? new Set<string>();
      set.add(s.campaign_name);
      brandToCampaigns.set(b, set);
    }
    if (unassigned > 0) {
      setError(`아직 분류되지 않은 캠페인이 ${unassigned}개 있습니다.`);
      return;
    }
    if (brandToCampaigns.size === 0) {
      setError("분류된 캠페인이 없습니다.");
      return;
    }

    let kindSlug: string;
    let kindDisplay: string;
    if (isNewKind) {
      kindSlug = newKindSlug.trim();
      kindDisplay = newKindDisplayName.trim();
      if (!kindSlug) {
        setError(
          "kind 슬러그가 비어 있습니다. 위쪽 'kind slug' 입력란에 값을 넣어주세요 (예: sp_search_term).",
        );
        return;
      }
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(kindSlug)) {
        setError(
          `kind 슬러그 '${kindSlug}' 가 유효하지 않습니다. 소문자로 시작, [a-z0-9_] 만 사용, 최대 41자.`,
        );
        return;
      }
      if (!kindDisplay) {
        setError("kind 표시 이름이 비어 있습니다. 위쪽 'kind 표시 이름' 입력란을 채워주세요.");
        return;
      }
    } else {
      if (!selectedKind) {
        setError("kind가 선택되지 않았습니다.");
        return;
      }
      kindSlug = selectedKind;
      // Resolve from the schema catalog. Reading another brand's
      // display_name would re-use that brand's prefix here (e.g.
      // "KAHI · Search Term Report".split("·")[0] → "KAHI"), and the new
      // type would end up named "<NEW BRAND> · KAHI".
      const schema = ALL_KINDS.find((k) => k.slug === kindSlug);
      kindDisplay = schema?.display_name ?? kindSlug;
    }

    setStep("committing");
    setProgress({ done: 0, total: 0, stage: "스키마 준비 중" });

    const brandTargets = new Map<string, BeginResponse>();
    const brandForCampaign = new Map<string, string>();
    for (const [brandSlug, campaigns] of brandToCampaigns) {
      for (const c of campaigns) brandForCampaign.set(c, brandSlug);

      const brand = brands.find((b) => b.slug === brandSlug);
      if (!brand) {
        setError(`브랜드를 찾지 못했습니다: ${brandSlug}`);
        setStep("assign");
        return;
      }
      const typeSlug = `${kindSlug}__${brandSlug}`;
      const existing = existingTypes.find((t) => t.slug === typeSlug);
      const isNewType = !existing;
      const displayName = `${brand.display_name} · ${kindDisplay}`;

      const beginRes = await fetch("/api/reports/commit/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: typeSlug,
          display_name: displayName,
          isNewType,
          headerPlan: plan,
          fileName: file.name,
          expectedRowCount: 0,
          brand: brand.display_name,
          kind: kindSlug,
        }),
      });
      if (!beginRes.ok) {
        const j = await beginRes.json().catch(() => ({}));
        setError(
          `${brand.display_name}: begin 실패 — ${j.error ?? beginRes.status}`,
        );
        setStep("assign");
        return;
      }
      brandTargets.set(brandSlug, (await beginRes.json()) as BeginResponse);
    }

    // Locate the date column's source header. Used both for continuation
    // mode filtering AND for tracking the per-brand date range surfaced
    // on the done step.
    const dateEntry = plan.find(
      (h) =>
        h.include &&
        (h.data_type === "date" || h.data_type === "timestamp"),
    );
    const dateSourceHeader = dateEntry?.source_header ?? null;
    const continueDateSourceHeader =
      continueMode && dateSourceHeader ? dateSourceHeader : null;
    // In continue mode every row is past the destination's max(date), so no
    // existing-row conflict is possible. Tell the server to use the cheaper
    // ON CONFLICT DO NOTHING path instead of DO UPDATE — saves a lot of
    // index work on huge tables like sp_raw.
    const conflictMode: "merge" | "ignore" = continueMode ? "ignore" : "merge";

    let result: MultiBrandResult;
    try {
      if (largeCsvMode) {
        result = await commitStreamingMultiBrand(
          file,
          brandTargets,
          brandForCampaign,
          headerRowIdx,
          headers,
          campaignSourceHeader!,
          continueDateSourceHeader,
          dateSourceHeader,
          conflictMode,
          (p) => setProgress(p),
        );
      } else {
        result = await commitInMemoryMultiBrand(
          rows,
          brandTargets,
          brandForCampaign,
          campaignSourceHeader!,
          continueDateSourceHeader,
          dateSourceHeader,
          conflictMode,
          (p) => setProgress(p),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
      setStep("assign");
      return;
    }

    const totalDone = result.totalDone;
    setProgress({ done: totalDone, total: totalDone, stage: "마무리 중" });
    await Promise.all(
      Array.from(brandTargets.values()).map((t) =>
        fetch("/api/reports/commit/finalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ upload_id: t.upload_id, row_count: totalDone }),
        }).catch(() => {}),
      ),
    );

    setResultBrands(
      Array.from(brandTargets.keys()).map((slug) => {
        const b = brands.find((x) => x.slug === slug);
        const stat = result.byBrand.get(slug);
        return {
          slug,
          display_name: b?.display_name ?? slug,
          rows: stat?.rows ?? 0,
          minDate: stat?.minDate ?? null,
          maxDate: stat?.maxDate ?? null,
        };
      }),
    );
    setResultSkipped(result.skippedByDate);
    setStep("done");
  }

  const totalAssignedRows = useMemo(() => {
    let n = 0;
    for (const s of campaignStats) {
      const b = assignments.get(s.campaign_name) || "";
      if (b) n += s.row_count;
    }
    return n;
  }, [campaignStats, assignments]);
  const unassignedCount = useMemo(
    () =>
      campaignStats.filter((s) => !(assignments.get(s.campaign_name) || "")).length,
    [campaignStats, assignments],
  );
  const assignedBrandsCount = useMemo(() => {
    const s = new Set<string>();
    for (const v of assignments.values()) if (v) s.add(v);
    return s.size;
  }, [assignments]);
  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  const streamingPct = (() => {
    if (!largeCsvMode) return null;
    const m = /(\d+)%/.exec(progress.stage);
    return m ? Number(m[1]) : 0;
  })();

  function resetPerFile() {
    setHeaders([]);
    setRows([]);
    setPreviewRows([]);
    setHeaderRowIdx(0);
    setPlan([]);
    setResultBrands([]);
    setResultSkipped(0);
    setSelectedKind("");
    setIsNewKind(false);
    setNewKindSlug("");
    setNewKindDisplayName("");
    setExistingColumns([]);
    setCampaignStats([]);
    setAssignments(new Map());
    setProgress({ done: 0, total: 0, stage: "" });
    setLargeCsvMode(false);
    fetch("/api/reports/types")
      .then((r) => r.json())
      .then((j) => setExistingTypes(j.types ?? []))
      .catch(() => {});
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            업로드
          </h1>
          <p className="text-gray-400 mt-2">
            CSV 또는 xlsx 파일을 올려 레포트를 저장합니다. 캠페인을 브랜드별로
            자동 분류하여 각 브랜드의 테이블에 저장합니다.
          </p>
        </div>
        <Link
          href="/brands/manage"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-purple-500/30 text-sm text-gray-300 hover:bg-cyan-500/10 hover:border-cyan-500/40 whitespace-nowrap"
        >
          <Tags size={14} /> 브랜드 관리
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {continueMode && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-sm">
          <span className="font-semibold whitespace-nowrap">이어서 업로드 모드</span>
          <span className="text-gray-300">
            {continueBrand && (
              <>
                <span className="text-cyan-300">{continueBrand}</span>{" "}
              </>
            )}
            대상 테이블의 마지막 데이터 이후 행만 추가됩니다. 그 이전(또는 같은
            날짜) 행은 자동으로 건너뜁니다.
          </span>
        </div>
      )}

      {step === "pick" && (
        <div className="space-y-3">
          <FileDrop
            onFiles={(files) => {
              if (files.length === 0) return;
              const [first, ...rest] = files;
              setFileQueue(rest);
              void handleFile(first);
            }}
          />
          {brands.length === 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
              <AlertCircle size={14} />
              <span>
                등록된 브랜드가 없습니다. 업로드 전에{" "}
                <Link href="/brands/manage" className="underline">
                  브랜드 관리
                </Link>
                에서 최소 1개 이상 추가하세요.
              </span>
            </div>
          )}
        </div>
      )}

      {fileQueue.length > 0 && step !== "pick" && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-sm">
          <span className="font-semibold">대기열 {fileQueue.length}개</span>
          <span className="text-gray-400">—</span>
          <span className="truncate">{fileQueue.map((f) => f.name).join(", ")}</span>
        </div>
      )}

      {(step === "kind" || step === "assign") && (
        <div className="text-sm text-gray-400">
          파일: <span className="font-mono text-gray-300">{file?.name}</span>
          {file && <> · <span className="text-gray-500">{fmtBytes(file.size)}</span></>}
          {" · "}
          {headers.length}개 열 ·{" "}
          {largeCsvMode ? (
            <span className="text-cyan-300">스트리밍 업로드 (대용량 CSV)</span>
          ) : (
            <>{rows.length.toLocaleString()}개 행</>
          )}
        </div>
      )}

      {step === "kind" && previewRows.length > 0 && (
        <HeaderRowPicker
          previewRows={previewRows}
          headerRowIndex={headerRowIdx}
          onChange={reparseWithHeaderRow}
        />
      )}

      {step === "kind" && (
        <div className="space-y-3">
          <h2 className="font-medium text-gray-200">레포트 종류 선택</h2>
          <p className="text-xs text-gray-500">
            이 파일이 어떤 레포트인지 고르세요. 컬럼 매핑은 자동으로 처리되어
            바로 브랜드 분배 단계로 넘어갑니다.
          </p>
          {schemaError && (
            <SchemaMissingNotice
              schema={schemaError.schema}
              missing={schemaError.missing}
              onDismiss={() => setSchemaError(null)}
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {ALL_KINDS.map((schema) => (
              <button
                key={schema.slug}
                onClick={() => pickKindSchema(schema)}
                disabled={scanningCampaigns}
                className="rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl p-4 hover:bg-cyan-500/10 hover:border-cyan-500/40 text-left transition-colors disabled:opacity-50 disabled:pointer-events-none flex flex-col gap-3"
              >
                <div>
                  <div className="font-medium text-gray-100">{schema.display_name}</div>
                  <div className="text-[11px] text-gray-400 mt-1">
                    {schema.description}
                  </div>
                </div>
                <SchemaColumnPreview schema={schema} />
              </button>
            ))}
          </div>
          {scanningCampaigns && (
            <div className="inline-flex items-center gap-1.5 text-xs text-cyan-300">
              <Loader2 size={12} className="animate-spin" />
              {progress.stage || "준비 중"}
            </div>
          )}
          <div>
            <button
              onClick={() => setStep("pick")}
              className="text-xs text-gray-400 hover:text-cyan-300"
            >
              ← 파일 다시 선택
            </button>
          </div>
        </div>
      )}

      {step === "assign" && (
        <div className="space-y-4">
          <div className="text-sm text-gray-300">
            캠페인별 브랜드 분류를 확인하세요. 자동 매칭된 것은 필요 시 수정할 수
            있고, 미분류된 캠페인은 반드시 브랜드를 지정해야 업로드가 진행됩니다.
          </div>
          <BrandAssignmentTable
            stats={campaignStats}
            brands={brands}
            rules={compiledRules}
            assignments={assignments}
            onChange={setAssignments}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStep("kind")}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md text-sm font-medium border border-cyan-500/30 bg-black/40 backdrop-blur-xl text-cyan-300 hover:bg-cyan-500/20"
            >
              뒤로
            </button>
            <button
              onClick={commit}
              disabled={unassignedCount > 0 || campaignStats.length === 0}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md text-sm font-medium bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/50 disabled:opacity-40"
            >
              커밋 ({totalAssignedRows.toLocaleString()}행, {assignedBrandsCount}개 브랜드)
            </button>
          </div>
        </div>
      )}

      {step === "committing" && (
        <div className="p-6 rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl shadow-lg shadow-purple-500/10 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Loader2 className="animate-spin text-cyan-400" size={16} />
            <span>
              {progress.stage}
              {progress.total > 0 ? (
                <>
                  : <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent font-semibold">{progress.done.toLocaleString()}</span> / {progress.total.toLocaleString()} 행 ({pct}%)
                </>
              ) : progress.done > 0 ? (
                <>
                  : <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent font-semibold">{progress.done.toLocaleString()}</span> 행
                </>
              ) : null}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-300"
              style={{ width: `${streamingPct ?? pct}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {largeCsvMode
              ? `파일을 읽으면서 브랜드별로 ${CHUNK_SIZE_STREAMING.toLocaleString()}행씩 업로드. 탭을 닫지 마세요.`
              : `브랜드별로 ${CHUNK_SIZE.toLocaleString()}행씩 ${CHUNK_PARALLEL}개 병렬 업로드.`}
          </p>
        </div>
      )}

      {step === "done" && resultBrands.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <CheckCircle2 size={20} />
            <span>
              <strong className="bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent">
                {progress.done.toLocaleString()}행
              </strong>{" "}
              저장 완료 · {resultBrands.length}개 브랜드
              {resultSkipped > 0 && (
                <span className="text-emerald-400/80 text-sm ml-2">
                  (이미 있는 {resultSkipped.toLocaleString()}행은 건너뜀)
                </span>
              )}
            </span>
          </div>

          <div className="rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-900/60">
                <tr className="text-left text-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-3 py-2 font-medium">브랜드</th>
                  <th className="px-3 py-2 font-medium text-right">신규 행수</th>
                  <th className="px-3 py-2 font-medium">기간</th>
                </tr>
              </thead>
              <tbody>
                {resultBrands.map((b) => (
                  <tr
                    key={b.slug}
                    className="border-t border-purple-500/10"
                  >
                    <td className="px-3 py-1.5 text-gray-200 font-medium">
                      {b.display_name}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-cyan-300">
                      {b.rows.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-400">
                      {b.minDate && b.maxDate ? (
                        b.minDate === b.maxDate ? (
                          <span>{b.minDate}</span>
                        ) : (
                          <span>
                            {b.minDate} ~ {b.maxDate}
                          </span>
                        )
                      ) : (
                        <span className="italic text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            {resultBrands.map((b) => (
              <Link
                key={b.slug}
                href={`/brands/${encodeURIComponent(b.display_name)}`}
                className="inline-flex items-center justify-center h-9 px-3 rounded-md text-xs font-medium border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
              >
                {b.display_name} 대시보드
              </Link>
            ))}
            {fileQueue.length > 0 && (
              <button
                onClick={() => {
                  const [next, ...rest] = fileQueue;
                  setFileQueue(rest);
                  resetPerFile();
                  void handleFile(next);
                }}
                className="inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white"
              >
                다음 파일 ({fileQueue.length}개 대기)
              </button>
            )}
            <button
              onClick={() => {
                setStep("pick");
                setFile(null);
                setFileQueue([]);
                resetPerFile();
              }}
              className="inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium border border-cyan-500/30 bg-black/40 backdrop-blur-xl text-cyan-300 hover:bg-cyan-500/20"
            >
              {fileQueue.length > 0 ? "대기열 비우기" : "다른 파일 올리기"}
            </button>
            <button
              onClick={() => router.push("/reports")}
              className="inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium text-gray-400 hover:text-cyan-300"
            >
              전체 레포트 보기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || ""
  );
}

/** Tiny info block on each kind card — lists required columns split into
 *  Dimension(필터/그룹용) and Metrics(숫자) so the user knows what to expect
 *  before clicking. */
function SchemaColumnPreview({ schema }: { schema: KindSchema }) {
  const dims = schema.columns.filter((c) => c.category === "dimension");
  const metrics = schema.columns.filter((c) => c.category === "metric");
  return (
    <div className="space-y-1.5 text-[10px] leading-relaxed pt-2 border-t border-purple-500/10">
      <div>
        <span className="inline-block px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-medium uppercase tracking-wide mr-1.5">
          Dimension
        </span>
        <span className="text-gray-400">
          {dims.map((c) => c.source_headers[0]).join(" · ")}
        </span>
      </div>
      <div>
        <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-medium uppercase tracking-wide mr-1.5">
          Metric
        </span>
        <span className="text-gray-400">
          {metrics.map((c) => c.source_headers[0]).join(" · ")}
        </span>
      </div>
    </div>
  );
}

/** Friendly missing-columns notice. Shows the full required schema grouped
 *  into Dimensions and Metrics, with the missing columns highlighted in red,
 *  so the user can fix the export and re-upload. */
function SchemaMissingNotice({
  schema,
  missing,
  onDismiss,
}: {
  schema: KindSchema;
  missing: KindColumn[];
  onDismiss: () => void;
}) {
  const missingNames = new Set(missing.map((m) => m.column_name));
  const dims = schema.columns.filter((c) => c.category === "dimension");
  const metrics = schema.columns.filter((c) => c.category === "metric");

  const renderCol = (c: KindColumn) => {
    const isMissing = missingNames.has(c.column_name);
    return (
      <li
        key={c.column_name}
        className={`flex items-baseline gap-2 ${
          isMissing ? "text-rose-300" : "text-gray-300"
        }`}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
            isMissing ? "bg-rose-400" : "bg-emerald-400/60"
          }`}
        />
        <span className="font-medium">{c.source_headers[0]}</span>
        <span className="text-[10px] text-gray-500">({c.ko})</span>
        {isMissing && (
          <span className="text-[10px] text-rose-300 font-semibold uppercase ml-auto">
            없음
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-rose-300">
            {schema.display_name}에 필요한 컬럼이 일부 빠져 있습니다
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            업로드한 CSV에 다음 컬럼이 모두 있는지 확인 후 다시 시도하세요. 빨간
            점은 빠진 컬럼입니다.
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          닫기
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-cyan-300 font-bold mb-1.5">
            Dimension <span className="text-gray-500 font-normal">(필터/그룹 기준)</span>
          </div>
          <ul className="text-xs space-y-1">{dims.map(renderCol)}</ul>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-amber-300 font-bold mb-1.5">
            Metric <span className="text-gray-500 font-normal">(측정값)</span>
          </div>
          <ul className="text-xs space-y-1">{metrics.map(renderCol)}</ul>
        </div>
      </div>
    </div>
  );
}

type ProgressState = { done: number; total: number; stage: string };

async function sendChunkToServer(
  begin: BeginResponse,
  rows: unknown[][],
  conflictMode: "merge" | "ignore" = "merge",
): Promise<void> {
  const body = JSON.stringify({
    upload_id: begin.upload_id,
    tableName: begin.tableName,
    columnNames: begin.columnNames,
    keyColumns: begin.keyColumns,
    dataTypes: begin.dataTypes,
    rows,
    conflictMode,
  });
  const TRANSIENT = new Set([429, 500, 502, 503, 504, 522, 524]);
  const MAX_ATTEMPTS = 5;
  let lastErr: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch("/api/reports/commit/chunk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (res.ok) return;
      const isTransient = TRANSIENT.has(res.status);
      const text = await res.text().catch(() => "");
      let msg: string;
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? `chunk failed (${res.status})`;
      } catch {
        msg = `chunk failed (${res.status})`;
      }
      lastErr = msg;
      const isServerBubbled5xx = /HTTP 5\d{2}/.test(msg);
      if (!isTransient && !isServerBubbled5xx) throw new Error(msg);
      if (attempt === MAX_ATTEMPTS - 1) throw new Error(msg);
    } catch (e) {
      if (attempt === MAX_ATTEMPTS - 1) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      lastErr = e instanceof Error ? e.message : String(e);
    }
    const delay = Math.min(20_000, 1000 * 2 ** attempt);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(lastErr ?? "chunk failed after retries");
}

/** In-memory commit routed per brand. Rows in each brand's buffer are uploaded
 *  in CHUNK_SIZE batches with CHUNK_PARALLEL requests in flight. */
interface BrandUploadStat {
  rows: number;
  minDate: string | null;
  maxDate: string | null;
}

interface MultiBrandResult {
  totalDone: number;
  skippedByDate: number;
  byBrand: Map<string, BrandUploadStat>;
}

/** Capture the date string from a row (sliced to YYYY-MM-DD) and update the
 *  running min/max for the matching brand bucket. */
function trackDate(
  bucket: BrandUploadStat,
  row: Record<string, unknown> | string[] | unknown[],
  dateKey: string | number | null,
) {
  if (dateKey == null) return;
  const v = Array.isArray(row)
    ? (row as unknown[])[dateKey as number]
    : (row as Record<string, unknown>)[dateKey as string];
  if (v == null) return;
  const d = String(v).slice(0, 10);
  if (!d) return;
  if (bucket.minDate == null || d < bucket.minDate) bucket.minDate = d;
  if (bucket.maxDate == null || d > bucket.maxDate) bucket.maxDate = d;
}

async function commitInMemoryMultiBrand(
  rows: Record<string, unknown>[],
  targets: Map<string, BeginResponse>,
  brandForCampaign: Map<string, string>,
  campaignSourceHeader: string,
  /** When non-null + the brand's begin response carries a latestDate,
   *  rows with date <= that date are skipped (continuation mode). */
  continueDateSourceHeader: string | null,
  /** Source header of the date column — used for tracking the date range
   *  of inserted rows even when continueMode isn't on. */
  dateSourceHeader: string | null,
  /** When "ignore", chunks tell the server to use ON CONFLICT DO NOTHING
   *  — much faster on large tables since it avoids the UPDATE path. Safe
   *  in continuation mode where every row is past the table's max date. */
  conflictMode: "merge" | "ignore",
  onProgress: (p: ProgressState) => void,
): Promise<MultiBrandResult> {
  const rowsByBrand = new Map<string, Record<string, unknown>[]>();
  const stats = new Map<string, BrandUploadStat>();
  for (const slug of targets.keys()) {
    stats.set(slug, { rows: 0, minDate: null, maxDate: null });
  }
  let total = 0;
  let skippedByDate = 0;
  for (const r of rows) {
    const name = String(r[campaignSourceHeader] ?? "");
    const brand = brandForCampaign.get(name);
    if (!brand) continue;

    if (continueDateSourceHeader) {
      const cutoff = targets.get(brand)?.latestDate;
      if (cutoff) {
        const v = r[continueDateSourceHeader];
        const d = v == null ? "" : String(v).slice(0, 10);
        if (d && d <= cutoff) {
          skippedByDate++;
          continue;
        }
      }
    }

    const bucket = stats.get(brand);
    if (bucket) {
      bucket.rows++;
      if (dateSourceHeader) trackDate(bucket, r, dateSourceHeader);
    }
    const arr = rowsByBrand.get(brand) ?? [];
    arr.push(r);
    rowsByBrand.set(brand, arr);
    total++;
  }
  if (skippedByDate > 0) {
    onProgress({
      done: 0,
      total,
      stage: `이어서 업로드: 기존 데이터 ${skippedByDate.toLocaleString()}행 건너뜀`,
    });
  }

  onProgress({ done: 0, total, stage: "데이터 업로드 중" });
  let done = 0;
  for (const [brandSlug, brandRows] of rowsByBrand) {
    const begin = targets.get(brandSlug);
    if (!begin) continue;
    const batches: Record<string, unknown>[][] = [];
    for (let i = 0; i < brandRows.length; i += CHUNK_SIZE) {
      batches.push(brandRows.slice(i, i + CHUNK_SIZE));
    }
    for (let i = 0; i < batches.length; i += CHUNK_PARALLEL) {
      const group = batches.slice(i, i + CHUNK_PARALLEL);
      await Promise.all(
        group.map(async (chunk) => {
          const rowArrays = chunk.map((r) =>
            begin.sourceHeaders.map((h) => r[h]),
          );
          await sendChunkToServer(begin, rowArrays, conflictMode);
          done += chunk.length;
          onProgress({ done, total, stage: `${brandSlug} 업로드 중` });
        }),
      );
    }
  }
  return { totalDone: done, skippedByDate, byBrand: stats };
}

/** Streaming multi-brand commit. Per-brand row buffers flushed as they fill. */
async function commitStreamingMultiBrand(
  file: File,
  targets: Map<string, BeginResponse>,
  brandForCampaign: Map<string, string>,
  headerRowIdx: number,
  allHeaders: string[],
  campaignSourceHeader: string,
  /** Non-null when the user enabled continuation mode and the file has a
   *  date column. Rows whose date is on/before the destination's latestDate
   *  are skipped. */
  continueDateSourceHeader: string | null,
  /** Source header of the date column — tracked for the per-brand date
   *  range surfaced on the done step. */
  dateSourceHeader: string | null,
  /** Same semantics as the in-memory path — "ignore" lets the server skip
   *  the heavier ON CONFLICT DO UPDATE path. */
  conflictMode: "merge" | "ignore",
  onProgress: (p: ProgressState) => void,
): Promise<MultiBrandResult> {
  const PapaMod = await import("papaparse");
  type ParseResult = { data: string[][]; meta?: { cursor?: number } };
  type Parser = { pause: () => void; resume: () => void; abort: () => void };
  const Papa = (PapaMod.default ?? PapaMod) as {
    parse: (
      input: File,
      config: {
        skipEmptyLines?: boolean | "greedy";
        chunk?: (r: ParseResult, p: Parser) => void;
        complete?: () => void;
        error?: (e: Error) => void;
      },
    ) => void;
  };

  const campaignCsvIdx = allHeaders.indexOf(campaignSourceHeader);
  // All targets share the same header plan (one CSV, same mapping) so we can
  // pick any target's sourceHeaders to build the column index layout.
  const firstTarget = targets.values().next().value as BeginResponse | undefined;
  if (!firstTarget) throw new Error("no brand targets");
  const csvIndexOf = firstTarget.sourceHeaders.map((h) =>
    allHeaders.indexOf(h),
  );
  const dateCsvIdx = continueDateSourceHeader
    ? allHeaders.indexOf(continueDateSourceHeader)
    : -1;
  const dateTrackIdx = dateSourceHeader
    ? allHeaders.indexOf(dateSourceHeader)
    : -1;
  let skippedByDate = 0;
  const stats = new Map<string, BrandUploadStat>();
  for (const slug of targets.keys()) {
    stats.set(slug, { rows: 0, minDate: null, maxDate: null });
  }

  const skipBeforeData = headerRowIdx + 1;
  const bufByBrand = new Map<string, unknown[][]>();
  for (const b of targets.keys()) bufByBrand.set(b, []);
  let seenRows = 0;
  let done = 0;
  let bytesCursor = 0;
  const totalBytes = file.size;
  const inflight = new Set<Promise<void>>();
  let flushError: Error | null = null;

  onProgress({ done: 0, total: 0, stage: "스트리밍 업로드 시작" });

  const reportProgress = () => {
    const pct =
      totalBytes > 0 ? Math.min(100, Math.round((bytesCursor / totalBytes) * 100)) : 0;
    const skip = skippedByDate
      ? ` · 기존 ${skippedByDate.toLocaleString()}행 건너뜀`
      : "";
    onProgress({
      done,
      total: 0,
      stage: `스트리밍 업로드 ${pct}% · ${fmtBytes(bytesCursor)} / ${fmtBytes(totalBytes)}${skip}`,
    });
  };

  const trySend = async () => {
    while (!flushError) {
      let flushed = false;
      for (const [brandSlug, buf] of bufByBrand) {
        while (buf.length >= CHUNK_SIZE_STREAMING) {
          while (inflight.size >= CHUNK_PARALLEL_STREAMING && !flushError) {
            await Promise.race([...inflight]);
          }
          if (flushError) break;
          const chunk = buf.splice(0, CHUNK_SIZE_STREAMING);
          const begin = targets.get(brandSlug)!;
          const p = sendChunkToServer(begin, chunk, conflictMode)
            .then(() => {
              done += chunk.length;
              reportProgress();
            })
            .catch((e) => {
              flushError = e instanceof Error ? e : new Error(String(e));
            })
            .finally(() => inflight.delete(p));
          inflight.add(p);
          flushed = true;
        }
      }
      if (!flushed) break;
    }
  };

  return new Promise<MultiBrandResult>((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: "greedy",
      chunk: (results, parser) => {
        parser.pause();
        (async () => {
          try {
            for (const row of results.data) {
              if (seenRows < skipBeforeData) {
                seenRows++;
                continue;
              }
              seenRows++;
              const name =
                campaignCsvIdx >= 0 ? String(row[campaignCsvIdx] ?? "") : "";
              const brand = brandForCampaign.get(name);
              if (!brand) continue;
              const buf = bufByBrand.get(brand);
              if (!buf) continue;
              if (dateCsvIdx >= 0) {
                const cutoff = targets.get(brand)?.latestDate;
                if (cutoff) {
                  const v = row[dateCsvIdx];
                  const d = v == null ? "" : String(v).slice(0, 10);
                  if (d && d <= cutoff) {
                    skippedByDate++;
                    continue;
                  }
                }
              }
              const bucket = stats.get(brand);
              if (bucket) {
                bucket.rows++;
                if (dateTrackIdx >= 0) trackDate(bucket, row, dateTrackIdx);
              }
              buf.push(csvIndexOf.map((i) => (i >= 0 ? (row[i] ?? null) : null)));
            }
            if (results.meta?.cursor != null) bytesCursor = results.meta.cursor;
            await trySend();
            if (flushError) {
              parser.abort();
              reject(flushError);
              return;
            }
            parser.resume();
          } catch (e) {
            parser.abort();
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      },
      complete: () => {
        (async () => {
          try {
            while (inflight.size > 0) {
              await Promise.race([...inflight]);
            }
            if (flushError) return reject(flushError);
            for (const [brandSlug, buf] of bufByBrand) {
              if (buf.length === 0) continue;
              const begin = targets.get(brandSlug)!;
              while (buf.length > 0 && !flushError) {
                const chunk = buf.splice(0, CHUNK_SIZE_STREAMING);
                await sendChunkToServer(begin, chunk, conflictMode);
                done += chunk.length;
                bytesCursor = totalBytes;
                reportProgress();
              }
            }
            if (flushError) return reject(flushError);
            resolve({ totalDone: done, skippedByDate, byBrand: stats });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      },
      error: (err) => reject(err),
    });
  });
}

/** Stream the file counting distinct campaign_name → row counts. */
async function scanCampaignsStreaming(
  file: File,
  headerRowIdx: number,
  allHeaders: string[],
  campaignSourceHeader: string,
  onProgress: (bytesCursor: number, totalBytes: number) => void,
): Promise<CampaignStat[]> {
  const PapaMod = await import("papaparse");
  type ParseResult = { data: string[][]; meta?: { cursor?: number } };
  type Parser = { pause: () => void; resume: () => void; abort: () => void };
  const Papa = (PapaMod.default ?? PapaMod) as {
    parse: (
      input: File,
      config: {
        skipEmptyLines?: boolean | "greedy";
        chunk?: (r: ParseResult, p: Parser) => void;
        complete?: () => void;
        error?: (e: Error) => void;
      },
    ) => void;
  };
  const campaignIdx = allHeaders.indexOf(campaignSourceHeader);
  if (campaignIdx < 0) throw new Error("campaign 컬럼을 파일에서 찾지 못했습니다.");
  const skipBeforeData = headerRowIdx + 1;
  const counts = new Map<string, number>();
  let seen = 0;
  const totalBytes = file.size;

  return new Promise<CampaignStat[]>((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: "greedy",
      chunk: (results) => {
        for (const row of results.data) {
          if (seen < skipBeforeData) {
            seen++;
            continue;
          }
          seen++;
          const name = String(row[campaignIdx] ?? "");
          if (!name) continue;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        if (results.meta?.cursor != null) {
          onProgress(results.meta.cursor, totalBytes);
        }
      },
      complete: () => {
        const stats: CampaignStat[] = Array.from(counts.entries()).map(
          ([n, c]) => ({
            campaign_name: n,
            row_count: c,
            auto_brand_slug: null,
            auto_rule_pattern: null,
          }),
        );
        resolve(stats);
      },
      error: (err) => reject(err),
    });
  });
}
