"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2, FileText, Calendar, AlertCircle } from "lucide-react";

interface UploadInfo {
  id: string;
  file_name: string;
  uploaded_at: string;
  row_count: number;
  db_row_count: number;
  min_date: string | null;
  max_date: string | null;
}

interface TypeWithUploads {
  type_id: string;
  slug: string;
  display_name: string;
  table_name: string;
  kind: string | null;
  uploads: UploadInfo[];
}

interface Props {
  brand: string;
}

/**
 * Brand-scoped upload management — lists every upload under each
 * report_type with the date range it covers, and lets the user delete
 * individual uploads (which removes only that upload's rows, not the
 * whole table).
 */
export default function UploadsTab({ brand }: Props) {
  const [types, setTypes] = useState<TypeWithUploads[]>([]);
  // Start loading=true so the very first render shows "불러오는 중..." rather
  // than flashing the "등록된 레포트 없음" empty state for a frame before the
  // useEffect runs setLoading(true).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/brands/${encodeURIComponent(brand)}/uploads`, {
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setTypes(j.types ?? []);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "로드 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [brand, refreshKey]);

  async function deleteUpload(u: UploadInfo, typeName: string) {
    const confirmed = window.confirm(
      `${typeName} 의 업로드 "${u.file_name}" (${u.db_row_count.toLocaleString()}행, ${u.min_date ?? "?"} ~ ${u.max_date ?? "?"}) 을 삭제할까요?\n\n` +
        `이 업로드로 들어온 행만 테이블에서 제거됩니다. 다른 업로드의 데이터는 영향 없습니다.`,
    );
    if (!confirmed) return;
    setDeletingId(u.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/brands/${encodeURIComponent(brand)}/uploads/${u.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `삭제 실패 (${res.status})`);
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-gray-100">업로드 관리</h2>
        <p className="text-xs text-gray-500">
          이 브랜드에 들어간 파일들과 각 파일이 커버하는 날짜 범위입니다.
          개별 업로드를 삭제하면 그 업로드로 들어온 행만 테이블에서 빠집니다.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && types.length === 0 ? (
        <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin text-cyan-400" /> 불러오는 중...
        </div>
      ) : types.length === 0 ? (
        <div className="p-10 rounded-lg border border-dashed border-purple-500/30 bg-slate-800/40 text-center text-sm text-gray-500">
          이 브랜드에 등록된 레포트가 없습니다.
        </div>
      ) : (
        <div className="space-y-4">
          {types.map((t) => (
            <div
              key={t.type_id}
              className="rounded-lg border border-purple-500/20 bg-slate-800/40 overflow-hidden"
            >
              <div className="px-4 py-2.5 border-b border-purple-500/20 flex items-center gap-2 text-sm">
                <span className="font-semibold text-gray-100">{t.display_name}</span>
                <span className="text-[11px] text-gray-500 font-mono">{t.slug}</span>
                <span className="flex-1" />
                <span className="text-[11px] text-gray-500">
                  업로드 {t.uploads.length}건
                </span>
              </div>
              {t.uploads.length === 0 ? (
                <div className="p-4 text-xs text-gray-500 italic">업로드 없음</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-900/40 text-gray-500 uppercase tracking-wide text-[10px]">
                    <tr>
                      <th className="text-left py-2 px-3">파일</th>
                      <th className="text-left py-2 px-3">업로드 시각</th>
                      <th className="text-left py-2 px-3">날짜 범위</th>
                      <th className="text-right py-2 px-3">DB 행수</th>
                      <th className="text-right py-2 px-3">기록상 행수</th>
                      <th className="text-right py-2 px-3 w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {t.uploads.map((u) => {
                      const orphan = u.db_row_count === 0 && u.row_count > 0;
                      return (
                        <tr
                          key={u.id}
                          className={`border-t border-purple-500/10 hover:bg-white/5 ${
                            orphan ? "opacity-60" : ""
                          }`}
                        >
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center gap-1.5 text-gray-200">
                              <FileText size={12} className="text-gray-500 shrink-0" />
                              <span className="truncate max-w-[220px]" title={u.file_name}>
                                {u.file_name || <em className="text-gray-500">(no name)</em>}
                              </span>
                            </span>
                          </td>
                          <td className="py-2 px-3 text-gray-400 tabular-nums">
                            {fmtDateTime(u.uploaded_at)}
                          </td>
                          <td className="py-2 px-3 text-gray-400">
                            {u.min_date && u.max_date ? (
                              <span className="inline-flex items-center gap-1">
                                <Calendar size={11} className="text-gray-500" />
                                <span className="font-mono">
                                  {u.min_date} ~ {u.max_date}
                                </span>
                              </span>
                            ) : (
                              <span className="italic text-gray-500">—</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            <span
                              className={
                                orphan ? "text-gray-500" : "text-cyan-300 font-medium"
                              }
                            >
                              {u.db_row_count.toLocaleString()}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-500">
                            {u.row_count.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              onClick={() => deleteUpload(u, t.display_name)}
                              disabled={deletingId === u.id}
                              className="p-1.5 rounded text-gray-400 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                              title={`이 업로드만 삭제 (${u.db_row_count.toLocaleString()}행)`}
                            >
                              {deletingId === u.id ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Trash2 size={13} />
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500 leading-relaxed">
        💡 <strong className="text-gray-400">DB 행수</strong> 와{" "}
        <strong className="text-gray-400">기록상 행수</strong> 가 다르면, 같은 key
        (보통 date + campaign + search/target) 로 들어온 다른 업로드가 그 행들을
        UPSERT 로 덮어쓴 상태입니다. DB 행수가 0 인 업로드는 사실상 의미 없는
        흔적이라 안전하게 삭제 가능.
      </p>
    </div>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
