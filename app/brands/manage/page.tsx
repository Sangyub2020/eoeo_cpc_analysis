"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, AlertCircle, Loader2, Save } from "lucide-react";
import type {
  Brand,
  BrandRule,
  MatchType,
} from "@/lib/brands/match";

type NewRuleDraft = { match_type: MatchType; pattern: string; priority: string };

const EMPTY_DRAFT: NewRuleDraft = { match_type: "contains", pattern: "", priority: "0" };

export default function BrandManagePage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [rules, setRules] = useState<BrandRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newDisplayName, setNewDisplayName] = useState("");
  const [adding, setAdding] = useState(false);

  const [ruleDrafts, setRuleDrafts] = useState<Record<string, NewRuleDraft>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/brands/catalog");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setBrands(j.brands ?? []);
      setRules(j.rules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rulesByBrand = useMemo(() => {
    const m = new Map<string, BrandRule[]>();
    for (const r of rules) {
      const arr = m.get(r.brand_id) ?? [];
      arr.push(r);
      m.set(r.brand_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort(
        (a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length,
      );
    }
    return m;
  }, [rules]);

  async function addBrand() {
    const name = newDisplayName.trim();
    if (!name) {
      setError("브랜드 이름이 필요합니다.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/brands/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: name }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setNewDisplayName("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setAdding(false);
    }
  }

  async function deleteBrand(b: Brand) {
    if (!window.confirm(`브랜드 "${b.display_name}" 를 삭제할까요? 매칭 룰도 함께 사라집니다.`))
      return;
    const res = await fetch(`/api/brands/catalog/${b.slug}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? `삭제 실패`);
      return;
    }
    await reload();
  }

  async function addRule(brand: Brand) {
    const draft = ruleDrafts[brand.id] ?? EMPTY_DRAFT;
    const pattern = draft.pattern.trim();
    if (!pattern) {
      setError("pattern 이 필요합니다.");
      return;
    }
    const res = await fetch(`/api/brands/catalog/${brand.slug}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        match_type: draft.match_type,
        pattern,
        priority: Number(draft.priority) || 0,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "룰 추가 실패");
      return;
    }
    setRuleDrafts((m) => ({ ...m, [brand.id]: EMPTY_DRAFT }));
    await reload();
  }

  async function deleteRule(ruleId: string) {
    if (!window.confirm("이 룰을 삭제할까요?")) return;
    const res = await fetch(`/api/brands/catalog/rules/${ruleId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "룰 삭제 실패");
      return;
    }
    await reload();
  }

  function patchDraft(brandId: string, patch: Partial<NewRuleDraft>) {
    setRuleDrafts((m) => ({
      ...m,
      [brandId]: { ...(m[brandId] ?? EMPTY_DRAFT), ...patch },
    }));
  }

  return (
    <div className="space-y-4">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-cyan-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> 목록으로
      </Link>

      <div>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
          브랜드 관리
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          업로드 시 캠페인 이름을 어떤 브랜드로 매칭할지 관리합니다. 한 브랜드에
          여러 룰을 추가할 수 있고, priority 가 높은 룰이 먼저 적용됩니다.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="p-4 rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl space-y-3">
        <h2 className="text-sm font-medium text-gray-200">새 브랜드 추가</h2>
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <label className="space-y-1">
            <span className="text-xs text-gray-400">브랜드 이름</span>
            <input
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !adding) {
                  e.preventDefault();
                  void addBrand();
                }
              }}
              placeholder="예: KAHI"
              className="w-full rounded border border-purple-500/30 bg-slate-900 px-2 py-1.5 text-sm text-gray-200 focus:border-cyan-500 focus:outline-none"
            />
          </label>
          <button
            onClick={addBrand}
            disabled={adding}
            className="h-9 px-3 rounded-md bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-sm font-medium hover:from-cyan-600 hover:to-purple-600 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            추가
          </button>
        </div>
        <p className="text-[11px] text-gray-500">
          이름만 입력하면 충분합니다. 캠페인 이름에 이 브랜드명을 포함하는
          <span className="font-mono"> contains</span> 룰이 자동 생성됩니다(대소문자 무관).
          내부 식별자(slug)는 시스템이 알아서 만듭니다.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin text-cyan-400" /> 불러오는 중...
        </div>
      ) : brands.length === 0 ? (
        <div className="p-10 rounded-lg border border-dashed border-purple-500/30 bg-slate-800/40 text-center text-gray-500 text-sm">
          아직 등록된 브랜드가 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {brands.map((b) => {
            const brandRules = rulesByBrand.get(b.id) ?? [];
            const draft = ruleDrafts[b.id] ?? EMPTY_DRAFT;
            return (
              <div
                key={b.id}
                className="rounded-lg border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl"
              >
                <div className="p-3 flex items-center gap-2 border-b border-purple-500/20">
                  <span className="text-sm font-semibold text-gray-100">
                    {b.display_name}
                  </span>
                  <span className="text-xs text-gray-500 font-mono">({b.slug})</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => deleteBrand(b)}
                    className="p-1.5 rounded text-gray-400 hover:text-rose-300 hover:bg-rose-500/10"
                    title="브랜드 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="p-3 space-y-2">
                  {brandRules.length === 0 ? (
                    <div className="text-xs text-gray-500 italic">룰이 없습니다.</div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 uppercase tracking-wide text-[10px]">
                          <th className="py-1 w-24">Match</th>
                          <th className="py-1">Pattern</th>
                          <th className="py-1 w-20">Priority</th>
                          <th className="py-1 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {brandRules.map((r) => (
                          <tr key={r.id} className="border-t border-purple-500/10">
                            <td className="py-1.5 font-mono text-gray-300">
                              {r.match_type}
                            </td>
                            <td className="py-1.5 font-mono text-gray-200">
                              {r.pattern}
                            </td>
                            <td className="py-1.5 text-gray-400 tabular-nums">
                              {r.priority}
                            </td>
                            <td className="py-1.5 text-right">
                              <button
                                onClick={() => deleteRule(r.id)}
                                className="p-1 rounded text-gray-400 hover:text-rose-300 hover:bg-rose-500/10"
                                title="룰 삭제"
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="pt-2 flex flex-wrap items-end gap-2">
                    <select
                      value={draft.match_type}
                      onChange={(e) =>
                        patchDraft(b.id, {
                          match_type: e.target.value as MatchType,
                        })
                      }
                      className="rounded border border-purple-500/30 bg-slate-900 px-2 py-1.5 text-xs text-gray-200 focus:border-cyan-500 focus:outline-none"
                      title="모든 매칭 방식은 대소문자 구분 없음"
                    >
                      <option value="contains">contains</option>
                      <option value="prefix">prefix</option>
                      <option value="regex">regex</option>
                    </select>
                    <input
                      value={draft.pattern}
                      onChange={(e) => patchDraft(b.id, { pattern: e.target.value })}
                      placeholder="pattern"
                      className="flex-1 min-w-[200px] rounded border border-purple-500/30 bg-slate-900 px-2 py-1.5 text-xs font-mono text-gray-200 focus:border-cyan-500 focus:outline-none"
                    />
                    <input
                      value={draft.priority}
                      onChange={(e) => patchDraft(b.id, { priority: e.target.value })}
                      type="number"
                      className="w-20 rounded border border-purple-500/30 bg-slate-900 px-2 py-1.5 text-xs text-gray-200 focus:border-cyan-500 focus:outline-none"
                      title="priority"
                    />
                    <button
                      onClick={() => addRule(b)}
                      className="h-8 px-3 rounded bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs hover:bg-cyan-500/30 inline-flex items-center gap-1"
                    >
                      <Save size={12} /> 룰 추가
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
