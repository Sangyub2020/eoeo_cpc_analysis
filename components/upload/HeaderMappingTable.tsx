"use client";

import { Sparkles, Database } from "lucide-react";
import type { DataType, HeaderPlan } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

interface Props {
  plan: HeaderPlan[];
  setPlan: (next: HeaderPlan[]) => void;
  allowKeyEdit: boolean;
  sampleRow?: Record<string, unknown>;
}

const TYPES: DataType[] = ["text", "numeric", "integer", "date", "timestamp", "boolean"];

export default function HeaderMappingTable({ plan, setPlan, allowKeyEdit, sampleRow }: Props) {
  function update(idx: number, patch: Partial<HeaderPlan>) {
    setPlan(plan.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  }

  return (
    <div className="border border-purple-500/20 bg-slate-800/40 backdrop-blur-xl shadow-lg shadow-purple-500/10 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-800 text-gray-300 text-sm font-medium border-b border-purple-500/20 text-left">
          <tr>
            <th className="px-4 py-3 w-10"></th>
            <th className="px-4 py-3">원본 헤더</th>
            <th className="px-4 py-3">샘플 값</th>
            <th className="px-4 py-3">DB 열 이름</th>
            <th className="px-4 py-3 w-32">타입</th>
            <th className="px-4 py-3 w-20 text-center">키</th>
            <th className="px-4 py-3 w-20 text-center">포함</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((h, idx) => {
            const sample = sampleRow ? String(sampleRow[h.source_header] ?? "") : "";
            return (
              <tr
                key={h.source_header}
                className={cn(
                  "border-b border-gray-700/50 hover:bg-white/5 text-gray-300",
                  !h.include && "opacity-50",
                )}
              >
                <td className="px-4 py-3">
                  {h.is_new ? (
                    <span
                      title="새 열 — DB에 추가됩니다"
                      className="inline-flex items-center gap-1 text-amber-300"
                    >
                      <Sparkles size={14} />
                    </span>
                  ) : (
                    <span
                      title="기존 열"
                      className="inline-flex items-center gap-1 text-emerald-300"
                    >
                      <Database size={14} />
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-gray-100">{h.source_header}</td>
                <td className="px-4 py-3 text-gray-500 truncate max-w-[160px]">{sample}</td>
                <td className="px-4 py-3">
                  <input
                    value={h.column_name}
                    onChange={(e) =>
                      update(idx, {
                        column_name: e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9_]/g, "_")
                          .slice(0, 63),
                      })
                    }
                    disabled={!h.is_new}
                    className="w-full rounded-md border border-purple-500/30 bg-slate-900 text-gray-200 px-2 py-1 font-mono text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={h.data_type}
                    onChange={(e) => update(idx, { data_type: e.target.value as DataType })}
                    disabled={!h.is_new}
                    className="w-full rounded-md border border-purple-500/30 bg-slate-900 text-gray-200 px-2 py-1 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={h.is_key}
                    onChange={(e) => update(idx, { is_key: e.target.checked })}
                    disabled={!allowKeyEdit}
                    className="accent-cyan-500"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={h.include}
                    onChange={(e) => update(idx, { include: e.target.checked })}
                    className="accent-cyan-500"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
