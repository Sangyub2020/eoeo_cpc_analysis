"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Search } from "lucide-react";
import type { Brand, CompiledRule } from "@/lib/brands/match";

interface CampaignStat {
  campaign_name: string;
  row_count: number;
  /** Null means no rule matched yet — user must assign manually. */
  auto_brand_slug: string | null;
  auto_rule_pattern: string | null;
  /** "history" = matched a previously uploaded campaign of the same name,
   *  "rule" = matched a brand rule, null = no auto-match. */
  auto_source?: "history" | "rule" | null;
}

interface Props {
  stats: CampaignStat[];
  brands: Brand[];
  rules: CompiledRule[];
  /** campaign_name → brand_slug ("" for unassigned). */
  assignments: Map<string, string>;
  onChange: (next: Map<string, string>) => void;
}

export default function BrandAssignmentTable({
  stats,
  brands,
  assignments,
  onChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stats.filter((s) => {
      if (showOnlyUnassigned && (assignments.get(s.campaign_name) || "")) return false;
      if (!q) return true;
      return s.campaign_name.toLowerCase().includes(q);
    });
  }, [stats, query, showOnlyUnassigned, assignments]);

  const unassignedCount = useMemo(
    () =>
      stats.filter((s) => !(assignments.get(s.campaign_name) || ""))
        .length,
    [stats, assignments],
  );

  const assignedByBrand = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stats) {
      const b = assignments.get(s.campaign_name) || "";
      if (!b) continue;
      m.set(b, (m.get(b) ?? 0) + s.row_count);
    }
    return m;
  }, [stats, assignments]);

  function setAssignment(campaign: string, brandSlug: string) {
    const next = new Map(assignments);
    next.set(campaign, brandSlug);
    onChange(next);
  }

  function bulkAssignFiltered(brandSlug: string) {
    const next = new Map(assignments);
    for (const s of filtered) next.set(s.campaign_name, brandSlug);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="캠페인 이름 검색"
            className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md border border-purple-500/30 bg-slate-900 text-gray-200 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={showOnlyUnassigned}
            onChange={(e) => setShowOnlyUnassigned(e.target.checked)}
            className="accent-cyan-500"
          />
          <span>미분류만 보기</span>
        </label>
        <div className="text-xs text-gray-400 whitespace-nowrap">
          총 {stats.length.toLocaleString()}개 캠페인 ·{" "}
          {unassignedCount > 0 ? (
            <span className="text-rose-300">미분류 {unassignedCount}</span>
          ) : (
            <span className="text-emerald-300 inline-flex items-center gap-1">
              <CheckCircle2 size={12} /> 모두 분류됨
            </span>
          )}
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>보이는 {filtered.length}개 일괄:</span>
          {brands.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => bulkAssignFiltered(b.slug)}
              className="px-2 py-0.5 rounded border border-purple-500/20 text-gray-300 hover:bg-cyan-500/10 hover:border-cyan-500/30"
            >
              {b.display_name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => bulkAssignFiltered("")}
            className="px-2 py-0.5 rounded border border-rose-500/20 text-rose-300 hover:bg-rose-500/10"
          >
            미분류로
          </button>
        </div>
      )}

      <div className="rounded-lg border border-purple-500/20 bg-slate-800/40 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-900/60">
            <tr className="text-left text-gray-500 uppercase tracking-wide text-[10px]">
              <th className="px-3 py-2 font-medium">Campaign name</th>
              <th className="px-2 py-2 w-20 text-right font-medium">Rows</th>
              <th className="px-2 py-2 w-32 font-medium">자동 매칭</th>
              <th className="px-3 py-2 w-48 font-medium">Brand</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const assigned = assignments.get(s.campaign_name) || "";
              const isAuto = assigned && assigned === (s.auto_brand_slug ?? "");
              const autoSource = s.auto_source ?? null;
              return (
                <tr
                  key={s.campaign_name}
                  className="border-t border-purple-500/10 hover:bg-white/5"
                >
                  <td className="px-3 py-1.5 font-mono text-gray-200 truncate max-w-[440px]">
                    {s.campaign_name}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-400 tabular-nums">
                    {s.row_count.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500">
                    {autoSource === "history" ? (
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        title="이전 업로드에서 같은 캠페인 이름이 이 브랜드로 분류되었습니다"
                      >
                        이전 업로드
                      </span>
                    ) : s.auto_rule_pattern ? (
                      <span
                        className="font-mono text-gray-400"
                        title={s.auto_rule_pattern}
                      >
                        {s.auto_rule_pattern}
                      </span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <select
                        value={assigned}
                        onChange={(e) =>
                          setAssignment(s.campaign_name, e.target.value)
                        }
                        className={`w-full rounded border px-2 py-1 text-xs focus:outline-none ${
                          assigned
                            ? "border-purple-500/30 bg-slate-900 text-gray-200"
                            : "border-rose-500/40 bg-rose-500/5 text-rose-300"
                        }`}
                      >
                        <option value="">(미분류)</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.slug}>
                            {b.display_name} ({b.slug})
                          </option>
                        ))}
                      </select>
                      {isAuto && (
                        <span
                          className={`text-[10px] shrink-0 ${
                            autoSource === "history"
                              ? "text-emerald-300/80"
                              : "text-cyan-300/70"
                          }`}
                          title={
                            autoSource === "history"
                              ? "이전 업로드에서 자동 매칭"
                              : "규칙 기반 자동 매칭"
                          }
                        >
                          {autoSource === "history" ? "이전" : "auto"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-gray-500 text-xs">
                  일치하는 캠페인이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {assignedByBrand.size > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-gray-400">
          <span>브랜드별 분배:</span>
          {brands
            .filter((b) => assignedByBrand.has(b.slug))
            .map((b) => (
              <span
                key={b.id}
                className="px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 inline-flex items-center gap-1"
              >
                {b.display_name}
                <span className="text-gray-400 tabular-nums">
                  {assignedByBrand.get(b.slug)?.toLocaleString()}
                </span>
              </span>
            ))}
        </div>
      )}

      {unassignedCount > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>{unassignedCount}개</strong>의 캠페인이 아직 브랜드에 분류되지
            않았습니다. 모두 분류해야 업로드를 진행할 수 있습니다.
          </span>
        </div>
      )}
    </div>
  );
}
