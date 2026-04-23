"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { FileBarChart2, Calendar, Database, Tag, Clock, Trash2, Loader2 } from "lucide-react";
import type { ReportSummary } from "@/lib/reports/summary";

interface Props {
  type: {
    slug: string;
    display_name: string;
    key_columns: string[];
    created_at: string;
    summary: ReportSummary | null;
  };
}

export default function ReportCard({ type }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const s = type.summary;

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rows = s?.rowCount;
    if (
      !window.confirm(
        `"${type.display_name}" 레포트를 완전히 삭제합니다.\n\n모든 데이터${rows ? ` (${rows.toLocaleString()}행)` : ""}와 테이블이 사라지며, 되돌릴 수 없습니다.\n\n계속하시겠어요?`,
      )
    ) {
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/reports/types/${type.slug}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${j.error ?? res.status}`);
      setDeleting(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="group relative rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl shadow-lg shadow-purple-500/10 hover:border-cyan-500/40 hover:shadow-cyan-500/10 transition-colors">
      <Link href={`/reports/${type.slug}`} className="block p-5">
        <div className="flex items-start gap-3">
          <FileBarChart2 size={20} className="text-cyan-400 mt-1 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-100 truncate">{type.display_name}</div>
            <div className="text-xs text-gray-500 font-mono truncate">{type.slug}</div>
          </div>
          {s && (
            <div className="text-right shrink-0 pr-8">
              <div className="text-xs text-gray-500">행 수</div>
              <div className="text-xl font-bold tabular-nums bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                {s.rowCount.toLocaleString()}
              </div>
            </div>
          )}
        </div>

        {s && (
          <div className="mt-4 space-y-2.5 text-sm">
            {s.dateRange && (s.dateRange.min || s.dateRange.max) && (
              <div className="flex items-center gap-2 text-gray-300">
                <Calendar size={14} className="text-gray-500 shrink-0" />
                <span className="truncate">
                  <span className="text-gray-500">{s.dateRange.source_header}:</span>{" "}
                  <span className="font-mono text-gray-200">
                    {fmtDate(s.dateRange.min)} ~ {fmtDate(s.dateRange.max)}
                  </span>
                  {s.dateRange.days != null && (
                    <span className="text-gray-500"> ({s.dateRange.days}일)</span>
                  )}
                </span>
              </div>
            )}

            {s.metrics.length > 0 && (
              <div className="flex items-start gap-2 text-gray-300">
                <Database size={14} className="text-gray-500 shrink-0 mt-0.5" />
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 min-w-0">
                  {s.metrics.map((m) => (
                    <div key={m.column} className="truncate">
                      <span className="text-gray-500">{m.source_header}:</span>{" "}
                      <span className="font-semibold tabular-nums text-gray-100">{fmtNum(m.sum)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {s.dimension && s.dimension.top.length > 0 && (
              <div className="flex items-start gap-2 text-gray-300">
                <Tag size={14} className="text-gray-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-gray-500">{s.dimension.source_header}</span>
                  <span className="text-gray-500 text-xs">
                    {" "}({s.dimension.distinctCount.toLocaleString()}종)
                  </span>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    {s.dimension.top.slice(0, 3).map((v, i) => (
                      <span key={i}>
                        {i > 0 && <span className="text-gray-600"> · </span>}
                        <span>{v.value ?? "∅"}</span>
                        <span className="text-gray-500"> ({v.count.toLocaleString()})</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {s.lastUploadedAt && (
              <div className="flex items-center gap-2 text-xs text-gray-500 pt-1">
                <Clock size={12} className="shrink-0" />
                마지막 업로드: {fmtDateTime(s.lastUploadedAt)}
              </div>
            )}
          </div>
        )}

        {!s && (
          <div className="mt-4 text-sm text-gray-500">
            요약을 불러오지 못했습니다 (데이터 없음 또는 테이블 접근 실패)
          </div>
        )}
      </Link>

      <button
        onClick={onDelete}
        disabled={deleting}
        title="삭제"
        className="absolute top-3 right-3 p-1.5 rounded-md text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-300 transition-opacity disabled:opacity-100"
      >
        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </button>
    </div>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "?";
  return d.slice(0, 10);
}

function fmtDateTime(d: string): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  const pad = (n: number) => String(n).padStart(2, "0");
  // Render in UTC so server (Node) and client (browser) agree — avoids hydration mismatch
  // from locale-dependent toLocaleString differences.
  return (
    dt.getUTCFullYear() +
    "." + pad(dt.getUTCMonth() + 1) +
    "." + pad(dt.getUTCDate()) +
    " " + pad(dt.getUTCHours()) +
    ":" + pad(dt.getUTCMinutes()) +
    " UTC"
  );
}

function fmtNum(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return Math.round(n).toLocaleString();
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}
