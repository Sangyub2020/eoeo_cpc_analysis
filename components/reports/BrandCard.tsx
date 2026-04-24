"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Trash2, Loader2 } from "lucide-react";

interface BrandCardMember {
  slug: string;
  display_name: string;
  summary: {
    rowCount?: number;
    lastUploadedAt?: string | null;
  } | null;
}

interface Props {
  brand: string;
  members: BrandCardMember[];
}

/**
 * Brand tile on the /reports landing page. Links to the brand dashboard,
 * and exposes an inline delete action that removes every report under the
 * brand (tables + metadata + brand-scoped history/views).
 */
export default function BrandCard({ brand, members }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalRows = members.reduce((s, m) => s + (m.summary?.rowCount ?? 0), 0);
  const lastUp = members
    .map((m) => m.summary?.lastUploadedAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);

  async function deleteBrand(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = window.confirm(
      `브랜드 "${brand}" 의 레포트 ${members.length}개 모두 삭제합니다. 각 테이블의 데이터도 전부 사라집니다. 계속할까요?`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setErr(null);
    try {
      for (const m of members) {
        const res = await fetch(`/api/reports/types/${m.slug}`, { method: "DELETE" });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `${m.slug} 삭제 실패 (${res.status})`);
        }
      }
      // Let the page refresh its server-component data.
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제 실패");
      setDeleting(false);
    }
  }

  return (
    <div className="relative group">
      <Link
        href={`/brands/${encodeURIComponent(brand)}`}
        className="p-6 rounded-xl border border-purple-500/30 bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-xl shadow-lg shadow-purple-500/10 hover:border-cyan-500/50 hover:shadow-cyan-500/10 transition-all block"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <FolderOpen
              className="text-cyan-300 group-hover:text-cyan-200 transition-colors"
              size={22}
            />
            <span className="text-2xl font-bold text-gray-100">{brand}</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 whitespace-nowrap">
            {members.length}개 레포트
          </span>
        </div>
        <div className="mt-4 space-y-1 text-xs text-gray-400">
          {members.map((m) => (
            <div key={m.slug} className="flex items-center gap-1.5">
              <span className="text-gray-600">•</span>
              <span className="truncate text-gray-300">{m.display_name}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3 text-xs text-gray-400 pt-3 border-t border-purple-500/10">
          <span>
            합계{" "}
            <span className="text-cyan-300 font-semibold tabular-nums">
              {totalRows.toLocaleString()}
            </span>
            행
          </span>
          {lastUp && (
            <span className="text-gray-500">· 최근 업로드 {lastUp.slice(0, 10)}</span>
          )}
        </div>
      </Link>

      <button
        onClick={deleteBrand}
        disabled={deleting}
        className="absolute top-3 right-3 p-2 rounded-md text-gray-500 bg-slate-900/70 backdrop-blur opacity-0 group-hover:opacity-100 hover:text-rose-300 hover:bg-rose-500/15 transition-all disabled:opacity-100 disabled:text-rose-300"
        title={`브랜드 "${brand}" 전체 삭제 (${members.length}개 레포트)`}
      >
        {deleting ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
      </button>

      {err && (
        <div className="absolute -bottom-8 left-0 right-0 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
          {err}
        </div>
      )}
    </div>
  );
}
