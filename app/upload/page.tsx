"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle, Plus, Sparkles } from "lucide-react";
import FileDrop from "@/components/upload/FileDrop";
import HeaderMappingTable from "@/components/upload/HeaderMappingTable";
import HeaderRowPicker from "@/components/upload/HeaderRowPicker";
import { parseSpreadsheet } from "@/lib/reports/parse";
import { inferDataType, normalizeHeader, dedupeNames } from "@/lib/reports/infer";
import type {
  DataType,
  HeaderPlan,
  ReportColumn,
  ReportType,
} from "@/lib/reports/types";

type Step = "pick" | "type" | "map" | "committing" | "done";

const CHUNK_SIZE = 8000;
const CHUNK_PARALLEL = 6;
/**
 * Streaming-mode overrides. Smaller chunks + lower parallelism reduce peak
 * payload size & pressure on Supabase/Cloudflare, which was returning sporadic
 * 502s on long uploads.
 */
const CHUNK_SIZE_STREAMING = 3000;
const CHUNK_PARALLEL_STREAMING = 3;
/**
 * Files above this threshold use a streaming path that reads the file line-by-line
 * with Papa Parse, so the browser never materializes the whole CSV in memory.
 * Only CSV is supported for streaming — xlsx requires full-file parsing.
 */
const LARGE_CSV_THRESHOLD = 100 * 1024 * 1024; // 100 MB
/** Bytes of the file pulled into memory for header/preview detection in streaming mode. */
const PREVIEW_SLICE_BYTES = 1 * 1024 * 1024; // 1 MB

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
}

export default function UploadPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [previewRows, setPreviewRows] = useState<unknown[][]>([]);
  const [headerRowIdx, setHeaderRowIdx] = useState(0);

  const [existingTypes, setExistingTypes] = useState<ReportType[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [existingColumns, setExistingColumns] = useState<ReportColumn[]>([]);

  const [newDisplayName, setNewDisplayName] = useState("");
  const [newSlug, setNewSlug] = useState("");

  const [plan, setPlan] = useState<HeaderPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultSlug, setResultSlug] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, stage: "" });
  /** When true, only the first PREVIEW_SLICE_BYTES of the file is in `rows`;
   *  full data is streamed directly from disk on commit. */
  const [largeCsvMode, setLargeCsvMode] = useState(false);
  /** Files waiting after the current one. Consumed one-at-a-time so each keeps
   *  its own type / mapping step. */
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  /** Brand / group tag applied to every report_type created/updated in this
   *  upload session. Letting the user set it once at the top of the page keeps
   *  all files in a queue under the same brand. */
  const [brandName, setBrandName] = useState("");

  useEffect(() => {
    fetch("/api/reports/types")
      .then((r) => r.json())
      .then((j) => setExistingTypes(j.types ?? []))
      .catch(() => {});
  }, []);

  // Prevent accidental reload/close while an upload is in progress
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
      // In large mode parsed.rows is only rows from the first 1MB — used for
      // preview/type inference. The full file is streamed later at commit time.
      setRows(parsed.rows);
      setPreviewRows(parsed.previewRows);
      setHeaderRowIdx(parsed.headerRowIndex);
      setStep("type");
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일 파싱 실패");
    }
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
        if (step === "map") {
          await rebuildPlan(parsed.headers, parsed.rows, selectedSlug, existingColumns);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "재파싱 실패");
      }
    },
    [file, step, selectedSlug, existingColumns, largeCsvMode],
  );

  async function rebuildPlan(
    newHeaders: string[],
    newRows: Record<string, unknown>[],
    slug: string,
    cols: ReportColumn[],
  ) {
    const suggestedNames = dedupeNames(
      newHeaders.map((h, i) => normalizeHeader(h, i)),
    );
    if (!slug) {
      const p: HeaderPlan[] = newHeaders.map((h, i) => {
        const sampleValues = newRows.slice(0, 50).map((r) => r[h]);
        return {
          source_header: h,
          column_name: suggestedNames[i],
          data_type: inferDataType(sampleValues),
          is_key: false,
          is_new: true,
          include: true,
        };
      });
      setPlan(p);
      return;
    }
    const byHeader = new Map(cols.map((c) => [c.source_header, c]));
    const takenNames = new Set(cols.map((c) => c.column_name));
    const p: HeaderPlan[] = newHeaders.map((h, i) => {
      const match = byHeader.get(h);
      if (match) {
        return {
          source_header: h,
          column_name: match.column_name,
          data_type: match.data_type,
          is_key: match.is_key,
          is_new: false,
          include: true,
        };
      }
      let name = suggestedNames[i];
      let n = 2;
      while (takenNames.has(name)) name = `${suggestedNames[i]}_${n++}`;
      takenNames.add(name);
      const sampleValues = newRows.slice(0, 50).map((r) => r[h]);
      return {
        source_header: h,
        column_name: name,
        data_type: inferDataType(sampleValues),
        is_key: false,
        is_new: true,
        include: true,
      };
    });
    setPlan(p);
  }

  async function pickExisting(slug: string) {
    setSelectedSlug(slug);
    if (!slug) {
      await rebuildPlan(headers, rows, "", []);
      setExistingColumns([]);
      setStep("map");
      return;
    }
    const res = await fetch(`/api/reports/types/${slug}`);
    if (!res.ok) {
      setError("레포트 타입 조회 실패");
      return;
    }
    const json = (await res.json()) as { type: ReportType; columns: ReportColumn[] };
    setExistingColumns(json.columns);
    await rebuildPlan(headers, rows, slug, json.columns);
    setStep("map");
  }

  async function commit() {
    setError(null);
    const isNewType = !selectedSlug;
    const slug = isNewType ? newSlug : selectedSlug;
    const display_name = isNewType
      ? newDisplayName
      : existingTypes.find((t) => t.slug === selectedSlug)?.display_name || slug;

    if (isNewType) {
      if (!newDisplayName.trim()) {
        setError("표시 이름이 필요합니다.");
        return;
      }
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(newSlug)) {
        setError("slug는 소문자로 시작, [a-z0-9_] 만 허용 (최대 63자).");
        return;
      }
    }

    setStep("committing");
    setProgress({ done: 0, total: largeCsvMode ? 0 : rows.length, stage: "스키마 준비 중" });

    // 1) begin
    const beginRes = await fetch("/api/reports/commit/begin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug,
        display_name,
        isNewType,
        headerPlan: plan,
        fileName: file?.name ?? "upload",
        // Row count is unknown in streaming mode — pass 0; server just stores it.
        expectedRowCount: largeCsvMode ? 0 : rows.length,
        brand: brandName.trim() || null,
      }),
    });
    if (!beginRes.ok) {
      const j = await beginRes.json().catch(() => ({}));
      setError(j.error ?? `begin failed (${beginRes.status})`);
      setStep("map");
      return;
    }
    const begin = (await beginRes.json()) as BeginResponse;

    // 2) chunk upload — streaming or in-memory
    let done = 0;
    try {
      if (largeCsvMode && file) {
        done = await commitStreaming(file, begin, headerRowIdx, headers, (progress) =>
          setProgress(progress),
        );
      } else {
        done = await commitInMemory(rows, begin, (progress) => setProgress(progress));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
      setStep("map");
      return;
    }

    // 3) finalize
    setProgress({ done, total: done, stage: "마무리 중" });
    await fetch("/api/reports/commit/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upload_id: begin.upload_id, row_count: done }),
    }).catch(() => {}); // non-critical

    setResultSlug(slug);
    setStep("done");
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

  const newCount = plan.filter((h) => h.is_new && h.include).length;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  // In streaming mode total is 0 but stage text carries "스트리밍 업로드 NN% …" — parse it for the bar.
  const streamingPct = (() => {
    if (!largeCsvMode) return null;
    const m = /(\d+)%/.exec(progress.stage);
    return m ? Number(m[1]) : 0;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
          업로드
        </h1>
        <p className="text-gray-400 mt-2">
          CSV 또는 xlsx 파일을 올려 레포트를 저장합니다.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {step === "pick" && (
        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl space-y-2">
            <label className="text-xs font-medium text-gray-300">
              브랜드 / 그룹명{" "}
              <span className="text-gray-500 font-normal">
                (선택 — 서치텀·타겟 두 파일을 같은 값으로 입력하면 한 대시보드에서 함께 보입니다)
              </span>
            </label>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="예: 프로포그 / KT Core / …"
              className="w-full rounded-lg border border-purple-500/30 bg-slate-900 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <FileDrop
            onFiles={(files) => {
              if (files.length === 0) return;
              const [first, ...rest] = files;
              setFileQueue(rest);
              void handleFile(first);
            }}
          />
        </div>
      )}
      {(step === "type" || step === "map" || step === "committing" || step === "done") &&
        brandName && (
          <div className="text-xs text-gray-400">
            브랜드: <span className="text-cyan-300 font-semibold">{brandName}</span>
          </div>
        )}
      {fileQueue.length > 0 && step !== "pick" && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-sm">
          <span className="font-semibold">대기열 {fileQueue.length}개</span>
          <span className="text-gray-400">—</span>
          <span className="truncate">
            {fileQueue.map((f) => f.name).join(", ")}
          </span>
        </div>
      )}

      {(step === "type" || step === "map") && (
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

      {(step === "type" || step === "map") && previewRows.length > 0 && (
        <HeaderRowPicker
          previewRows={previewRows}
          headerRowIndex={headerRowIdx}
          onChange={reparseWithHeaderRow}
        />
      )}

      {step === "type" && (
        <div className="space-y-3">
          <h2 className="font-medium text-gray-200">레포트 타입 선택</h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => pickExisting("")}
              className="rounded-lg border border-dashed border-purple-500/30 bg-slate-800/40 backdrop-blur-xl p-4 hover:bg-cyan-500/10 hover:border-cyan-500/40 text-left transition-colors"
            >
              <div className="flex items-center gap-2 font-medium text-cyan-300">
                <Plus size={16} /> 새 타입 만들기
              </div>
              <p className="text-xs text-gray-400 mt-1">이 파일 형식으로 새 테이블을 만듭니다</p>
            </button>
            {existingTypes.map((t) => (
              <button
                key={t.slug}
                onClick={() => pickExisting(t.slug)}
                className="rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl shadow-lg shadow-purple-500/10 p-4 hover:bg-white/5 hover:border-cyan-500/30 text-left transition-colors"
              >
                <div className="font-medium text-gray-200">{t.display_name}</div>
                <div className="text-xs text-gray-500 font-mono">{t.slug}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "map" && (
        <div className="space-y-4">
          {!selectedSlug && (
            <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl shadow-lg shadow-purple-500/10">
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-400">표시 이름</span>
                <input
                  value={newDisplayName}
                  onChange={(e) => {
                    setNewDisplayName(e.target.value);
                    if (!newSlug || newSlug === slugify(newDisplayName))
                      setNewSlug(slugify(e.target.value));
                  }}
                  placeholder="예: SP 캠페인 일별"
                  className="w-full rounded-lg border border-purple-500/30 bg-slate-800 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-400">slug (테이블 식별자)</span>
                <input
                  value={newSlug}
                  onChange={(e) => setNewSlug(slugify(e.target.value))}
                  placeholder="sp_campaign_daily"
                  className="w-full rounded-lg border border-purple-500/30 bg-slate-800 px-3 py-2 font-mono text-sm text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
                />
              </label>
            </div>
          )}

          {newCount > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm">
              <Sparkles size={16} />
              <span>
                <strong className="bg-gradient-to-r from-amber-400 to-yellow-400 bg-clip-text text-transparent">{newCount}개</strong>의 새 열이 DB에 추가됩니다. 열 이름과 타입을 확인하세요.
              </span>
            </div>
          )}

          <HeaderMappingTable
            plan={plan}
            setPlan={setPlan}
            allowKeyEdit={!selectedSlug}
            sampleRow={rows[0]}
          />

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStep("type")}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md text-sm font-medium border border-cyan-500/30 bg-black/40 backdrop-blur-xl text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              뒤로
            </button>
            <button
              onClick={commit}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md text-sm font-medium bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/50 transition-colors"
            >
              커밋 ({largeCsvMode ? `${fmtBytes(file?.size ?? 0)} 스트리밍` : `${rows.length.toLocaleString()}행`})
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
                  : <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent font-semibold">{progress.done.toLocaleString()}</span> 행 업로드 완료
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
              ? `파일을 읽으면서 ${CHUNK_SIZE_STREAMING.toLocaleString()}행씩 ${CHUNK_PARALLEL_STREAMING}개 병렬 업로드 (transient 502는 자동 재시도). 탭을 닫지 마세요.`
              : `대용량 파일은 ${CHUNK_SIZE.toLocaleString()}행씩 ${CHUNK_PARALLEL}개 병렬로 업로드합니다. 브라우저 탭을 닫지 마세요.`}
          </p>
        </div>
      )}

      {step === "done" && resultSlug && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <CheckCircle2 size={20} />
            <span>
              <strong className="bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent">{progress.done.toLocaleString()}행</strong> 저장 완료.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push(`/reports/${resultSlug}`)}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md text-sm font-medium bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/50 transition-colors"
            >
              레포트 보기
            </button>
            {fileQueue.length > 0 && (
              <button
                onClick={() => {
                  const [next, ...rest] = fileQueue;
                  setFileQueue(rest);
                  // Reset per-file state, then feed the next file through the
                  // normal handler which re-triggers parse → type → map.
                  setHeaders([]);
                  setRows([]);
                  setPreviewRows([]);
                  setHeaderRowIdx(0);
                  setPlan([]);
                  setResultSlug(null);
                  setSelectedSlug("");
                  setExistingColumns([]);
                  setNewDisplayName("");
                  setNewSlug("");
                  setProgress({ done: 0, total: 0, stage: "" });
                  setLargeCsvMode(false);
                  // Refresh the existing-types list so the newly-created one
                  // (from this upload) shows up for the next file.
                  fetch("/api/reports/types")
                    .then((r) => r.json())
                    .then((j) => setExistingTypes(j.types ?? []))
                    .catch(() => {});
                  void handleFile(next);
                }}
                className="inline-flex items-center justify-center h-10 px-4 rounded-md text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/50 transition-colors"
              >
                다음 파일 올리기 ({fileQueue.length}개 대기)
              </button>
            )}
            <button
              onClick={() => {
                setStep("pick");
                setFile(null);
                setHeaders([]);
                setRows([]);
                setPreviewRows([]);
                setHeaderRowIdx(0);
                setPlan([]);
                setResultSlug(null);
                setSelectedSlug("");
                setNewDisplayName("");
                setNewSlug("");
                setProgress({ done: 0, total: 0, stage: "" });
                setLargeCsvMode(false);
                setFileQueue([]);
              }}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md text-sm font-medium border border-cyan-500/30 bg-black/40 backdrop-blur-xl text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              {fileQueue.length > 0 ? "대기열 비우기 / 처음부터" : "다른 파일 올리기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type ProgressState = { done: number; total: number; stage: string };

interface BeginForCommit {
  upload_id: string;
  tableName: string;
  columnNames: string[];
  keyColumns: string[];
  dataTypes: BeginResponse["dataTypes"];
  sourceHeaders: string[];
}

/**
 * Client-side retry for the chunk API call. The server-side already retries
 * PostgREST calls against Supabase, but transient 502s can also hit us
 * between the browser and our own Next.js route (Vercel/Cloudflare edge),
 * or a specific chunk can genuinely hit PostgREST timeouts.
 * Retries up to 5 times with exponential backoff.
 */
async function sendChunkToServer(
  begin: BeginForCommit,
  rows: unknown[][],
): Promise<void> {
  const body = JSON.stringify({
    upload_id: begin.upload_id,
    tableName: begin.tableName,
    columnNames: begin.columnNames,
    keyColumns: begin.keyColumns,
    dataTypes: begin.dataTypes,
    rows,
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
      // Body may be JSON with {error} or HTML (gateway error pages).
      const text = await res.text().catch(() => "");
      let msg: string;
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? `chunk failed (${res.status})`;
      } catch {
        msg = `chunk failed (${res.status})`;
      }
      lastErr = msg;
      // Also retry when the server bubbled up an "HTTP 5xx" from its PostgREST call.
      const isServerBubbled5xx = /HTTP 5\d{2}/.test(msg);
      if (!isTransient && !isServerBubbled5xx) throw new Error(msg);
      if (attempt === MAX_ATTEMPTS - 1) throw new Error(msg);
    } catch (e) {
      // Network-level error (e.g. fetch rejected). Retry unless final attempt.
      if (attempt === MAX_ATTEMPTS - 1) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      lastErr = e instanceof Error ? e.message : String(e);
    }
    const delay = Math.min(20_000, 1000 * 2 ** attempt); // 1s, 2s, 4s, 8s, 16s
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(lastErr ?? "chunk failed after retries");
}

/** Existing in-memory path for small files. */
async function commitInMemory(
  rows: Record<string, unknown>[],
  begin: BeginResponse,
  onProgress: (p: ProgressState) => void,
): Promise<number> {
  onProgress({ done: 0, total: rows.length, stage: "데이터 업로드 중" });
  const batches: Record<string, unknown>[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    batches.push(rows.slice(i, i + CHUNK_SIZE));
  }
  let done = 0;
  for (let i = 0; i < batches.length; i += CHUNK_PARALLEL) {
    const group = batches.slice(i, i + CHUNK_PARALLEL);
    await Promise.all(
      group.map(async (chunk) => {
        const rowArrays = chunk.map((r) => begin.sourceHeaders.map((h) => r[h]));
        await sendChunkToServer(begin, rowArrays);
        done += chunk.length;
        onProgress({ done, total: rows.length, stage: "데이터 업로드 중" });
      }),
    );
  }
  return done;
}

/**
 * Streaming path for large CSVs. Reads the file line-by-line via Papa Parse
 * (which internally uses File.stream), buffers rows, and flushes CHUNK_SIZE-sized
 * batches to the server with at most CHUNK_PARALLEL requests in flight.
 *
 * Peak memory usage is bounded by the row buffer + inflight payloads,
 * so a 1.7 GB CSV stays well under 200 MB of JS heap.
 */
async function commitStreaming(
  file: File,
  begin: BeginResponse,
  headerRowIdx: number,
  allHeaders: string[],
  onProgress: (p: ProgressState) => void,
): Promise<number> {
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

  // CSV column index for each included source header. -1 indicates the column
  // isn't present (shouldn't happen normally; we pass null in that case).
  const csvIndexOf = begin.sourceHeaders.map((h) => allHeaders.indexOf(h));
  // Rows to skip before the first data row: title rows + the header row itself.
  const skipBeforeData = headerRowIdx + 1;

  const rowBuf: unknown[][] = [];
  let seenRows = 0;
  let done = 0;
  let bytesCursor = 0;
  const totalBytes = file.size;
  const inflight = new Set<Promise<void>>();
  let flushError: Error | null = null;

  onProgress({ done: 0, total: 0, stage: "스트리밍 업로드 시작" });

  const reportProgress = () => {
    const pct =
      totalBytes > 0
        ? Math.min(100, Math.round((bytesCursor / totalBytes) * 100))
        : 0;
    onProgress({
      done,
      total: 0,
      stage: `스트리밍 업로드 ${pct}% · ${fmtBytes(bytesCursor)} / ${fmtBytes(totalBytes)}`,
    });
  };

  const trySend = async () => {
    while (!flushError && rowBuf.length >= CHUNK_SIZE_STREAMING) {
      while (inflight.size >= CHUNK_PARALLEL_STREAMING && !flushError) {
        await Promise.race([...inflight]);
      }
      if (flushError) break;
      const chunk = rowBuf.splice(0, CHUNK_SIZE_STREAMING);
      const p = sendChunkToServer(begin, chunk)
        .then(() => {
          done += chunk.length;
          reportProgress();
        })
        .catch((e) => {
          flushError = e instanceof Error ? e : new Error(String(e));
        })
        .finally(() => inflight.delete(p));
      inflight.add(p);
    }
  };

  return new Promise<number>((resolve, reject) => {
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
              rowBuf.push(
                csvIndexOf.map((i) => (i >= 0 ? (row[i] ?? null) : null)),
              );
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
            // Wait for all inflight requests to finish.
            while (inflight.size > 0) {
              await Promise.race([...inflight]);
            }
            if (flushError) {
              reject(flushError);
              return;
            }
            // Flush remaining rows in (possibly smaller) batches.
            while (rowBuf.length > 0 && !flushError) {
              const chunk = rowBuf.splice(0, CHUNK_SIZE_STREAMING);
              await sendChunkToServer(begin, chunk);
              done += chunk.length;
              bytesCursor = totalBytes;
              reportProgress();
            }
            if (flushError) {
              reject(flushError);
              return;
            }
            resolve(done);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      },
      error: (err) => reject(err),
    });
  });
}
