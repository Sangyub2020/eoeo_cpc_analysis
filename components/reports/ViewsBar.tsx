"use client";

import { useEffect, useState } from "react";
import { Bookmark, Plus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SavedView<TConfig> {
  id: string;
  name: string;
  config: TConfig;
  created_at: string;
  updated_at: string;
}

interface Props<TConfig> {
  /** Base URL for the views endpoints. We append `/views` and `/views/<id>`.
   *  `/api/reports/<slug>` for per-report, `/api/brands/<brand>` for brand-wide. */
  baseUrl: string;
  activeViewId: string | null;
  currentConfig: TConfig;
  onLoad: (view: SavedView<TConfig>) => void;
  /** triggers remount of views-dependent children after save/delete */
  refreshKey?: number;
}

export default function ViewsBar<TConfig>({
  baseUrl,
  activeViewId,
  currentConfig,
  onLoad,
  refreshKey = 0,
}: Props<TConfig>) {
  const [views, setViews] = useState<SavedView<TConfig>[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bumpedKey, setBumpedKey] = useState(0);

  useEffect(() => {
    if (!baseUrl) return;
    const abort = new AbortController();
    setLoading(true);
    fetch(`${baseUrl}/views`, { signal: abort.signal })
      .then((r) => r.json())
      .then((j) => setViews(j.views ?? []))
      .catch((e) => {
        if (e.name !== "AbortError") setViews([]);
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [baseUrl, refreshKey, bumpedKey]);

  async function saveCurrent() {
    const name = window.prompt("뷰 이름?");
    if (!name?.trim()) return;
    setSaving(true);
    const res = await fetch(`${baseUrl}/views`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), config: currentConfig }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`저장 실패: ${j.error ?? res.status}`);
      return;
    }
    setBumpedKey((k) => k + 1);
  }

  async function updateCurrent(viewId: string) {
    if (!window.confirm("현재 화면 설정으로 이 뷰를 덮어쓸까요?")) return;
    setSaving(true);
    const res = await fetch(`${baseUrl}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: currentConfig }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`업데이트 실패: ${j.error ?? res.status}`);
      return;
    }
    setBumpedKey((k) => k + 1);
  }

  async function renameView(viewId: string, oldName: string) {
    const name = window.prompt("새 이름", oldName);
    if (!name || name.trim() === oldName) return;
    const res = await fetch(`${baseUrl}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`이름 변경 실패: ${j.error ?? res.status}`);
      return;
    }
    setBumpedKey((k) => k + 1);
  }

  async function deleteView(viewId: string, name: string) {
    if (!window.confirm(`"${name}" 뷰를 삭제할까요?`)) return;
    const res = await fetch(`${baseUrl}/views/${viewId}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${j.error ?? res.status}`);
      return;
    }
    setBumpedKey((k) => k + 1);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <Bookmark size={14} className="text-cyan-400" />
        <span>뷰</span>
        {loading && <Loader2 size={12} className="animate-spin text-cyan-400" />}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap flex-1">
        {views.length === 0 && !loading && (
          <span className="text-xs text-gray-500">(저장된 뷰 없음 — 현재 설정을 저장해 보세요)</span>
        )}
        {views.map((v) => {
          const active = v.id === activeViewId;
          return (
            <div
              key={v.id}
              className={cn(
                "group inline-flex items-center rounded-full border text-sm transition-colors",
                active
                  ? "border-cyan-500/30 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-300 shadow-md shadow-cyan-500/10"
                  : "border-purple-500/30 bg-slate-800 text-gray-300 hover:border-cyan-500/40 hover:text-cyan-300",
              )}
            >
              <button
                onClick={() => onLoad(v)}
                onDoubleClick={() => renameView(v.id, v.name)}
                title={`${v.name} (더블클릭하여 이름 변경)`}
                className="pl-3 pr-1 py-1 truncate max-w-[200px]"
              >
                {v.name}
              </button>
              {active && (
                <button
                  onClick={() => updateCurrent(v.id)}
                  title="현재 화면 설정으로 덮어쓰기"
                  className="px-1.5 py-1 text-[10px] opacity-70 hover:opacity-100"
                >
                  저장
                </button>
              )}
              <button
                onClick={() => deleteView(v.id, v.name)}
                className={cn(
                  "px-1.5 py-1 rounded-r-full opacity-0 group-hover:opacity-60 hover:opacity-100",
                  active && "opacity-70",
                )}
                title="삭제"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={saveCurrent}
        disabled={saving}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-dashed border-purple-500/30 text-sm text-gray-400 hover:bg-white/5 hover:text-cyan-300 hover:border-cyan-500/40 disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        현재 설정 저장
      </button>
    </div>
  );
}
