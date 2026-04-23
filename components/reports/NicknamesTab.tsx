"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Save, Check } from "lucide-react";

interface Props {
  brand: string;
  /** A report slug that has a `campaign_name` column — used to fetch the
   *  list of distinct campaigns for this brand. */
  primarySlug: string;
  /** Called whenever a nickname is saved/cleared so the parent can refresh
   *  its in-memory nicknames map (used by charts/panels). */
  onChanged?: () => void;
}

/** Settings tab: lists every campaign in the brand and lets the user assign
 *  a short nickname to each. Nicknames are displayed in chart titles and the
 *  right-side campaign panel to keep long Amazon campaign names readable. */
export default function NicknamesTab({ brand, primarySlug, onChanged }: Props) {
  const [campaigns, setCampaigns] = useState<{ value: string; count: number }[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  /** Local draft: what the user is currently typing for each row. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/reports/${primarySlug}/distinct`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ column: "campaign_name", limit: 2000 }),
        signal: abort.signal,
      }).then((r) => r.json()),
      fetch(`/api/brands/${encodeURIComponent(brand)}/nicknames`, {
        signal: abort.signal,
      }).then((r) => r.json()),
    ])
      .then(([dist, nicks]) => {
        if (dist.error) throw new Error(dist.error);
        const rows = (dist.values ?? [])
          .filter((v: { value: string | null }) => v.value != null)
          .map((v: { value: string; count: number }) => ({ value: v.value, count: v.count }));
        setCampaigns(rows);
        const nmap: Record<string, string> = {};
        for (const n of nicks.nicknames ?? []) nmap[n.campaign_name] = n.nickname;
        setNicknames(nmap);
        setDrafts(nmap); // start drafts synced with saved values
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "로드 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [brand, primarySlug]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter(
      (c) =>
        c.value.toLowerCase().includes(q) ||
        (nicknames[c.value] ?? "").toLowerCase().includes(q),
    );
  }, [campaigns, nicknames, search]);

  async function save(campaign: string) {
    const nickname = (drafts[campaign] ?? "").trim();
    setSavingFor(campaign);
    setError(null);
    try {
      const res = await fetch(`/api/brands/${encodeURIComponent(brand)}/nicknames`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_name: campaign, nickname }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `save failed (${res.status})`);
      }
      setNicknames((prev) => {
        const next = { ...prev };
        if (nickname) next[campaign] = nickname;
        else delete next[campaign];
        return next;
      });
      setJustSaved(campaign);
      setTimeout(() => setJustSaved((x) => (x === campaign ? null : x)), 1200);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSavingFor(null);
    }
  }

  const changedCount = Object.entries(drafts).filter(
    ([k, v]) => (v ?? "").trim() !== (nicknames[k] ?? ""),
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-100">캠페인 닉네임</h2>
          <p className="text-xs text-gray-500">
            긴 Amazon 캠페인명을 짧은 닉네임으로 대체해서 차트에서 보기 쉽게 만듭니다.
            브랜드별로 저장됩니다.
          </p>
        </div>
      </div>

      <div className="p-3 rounded-lg border border-purple-500/20 bg-slate-800/40 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="캠페인 이름 또는 닉네임 검색"
            className="w-full pl-6 pr-2 py-1.5 text-xs rounded border border-purple-500/20 bg-slate-900 text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap">
          총 {campaigns.length}개 · 닉네임 {Object.keys(nicknames).length}개
          {changedCount > 0 && (
            <span className="ml-2 text-amber-300">· 저장 안 됨 {changedCount}개</span>
          )}
        </span>
        {loading && <Loader2 size={12} className="animate-spin text-cyan-400" />}
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          {error}
        </div>
      )}

      <div className="border border-purple-500/20 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-purple-500/20 bg-slate-800/40 flex items-center gap-2 text-[11px] text-gray-400 uppercase tracking-wide">
          <span className="flex-1">캠페인 이름</span>
          <span className="w-16 text-right">행</span>
          <span className="w-64">닉네임</span>
          <span className="w-16" />
        </div>
        <div className="max-h-[600px] overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-gray-500 text-sm">
              {campaigns.length === 0
                ? loading
                  ? "불러오는 중..."
                  : "캠페인이 없습니다."
                : "일치하는 캠페인이 없습니다."}
            </div>
          ) : (
            filtered.map((c) => {
              const draft = drafts[c.value] ?? "";
              const saved = nicknames[c.value] ?? "";
              const dirty = draft.trim() !== saved;
              return (
                <div
                  key={c.value}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 border-b border-purple-500/10 last:border-b-0"
                >
                  <span
                    className="flex-1 truncate text-gray-200 font-mono"
                    title={c.value}
                  >
                    {c.value}
                  </span>
                  <span className="w-16 text-right text-gray-500 tabular-nums">
                    {c.count.toLocaleString()}
                  </span>
                  <input
                    value={draft}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [c.value]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && dirty) void save(c.value);
                    }}
                    onBlur={() => {
                      if (dirty) void save(c.value);
                    }}
                    placeholder="닉네임 입력"
                    className={`w-64 px-2 py-1 text-xs rounded border bg-slate-900 text-gray-100 placeholder:text-gray-500 focus:outline-none ${
                      dirty
                        ? "border-amber-500/50 focus:border-amber-400"
                        : "border-purple-500/20 focus:border-cyan-500"
                    }`}
                  />
                  <div className="w-16 flex items-center justify-end">
                    {savingFor === c.value ? (
                      <Loader2 size={12} className="animate-spin text-cyan-400" />
                    ) : justSaved === c.value ? (
                      <Check size={14} className="text-emerald-400" />
                    ) : dirty ? (
                      <button
                        onClick={() => save(c.value)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-600 hover:to-purple-600"
                        title="저장 (Enter)"
                      >
                        <Save size={10} /> 저장
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500">
        💡 닉네임 입력 후 <kbd className="px-1 py-0.5 rounded bg-slate-900 border border-purple-500/30 font-mono text-[10px]">Enter</kbd>{" "}
        또는 포커스 이탈 시 자동 저장. 비우고 저장하면 닉네임 제거.
      </p>
    </div>
  );
}
