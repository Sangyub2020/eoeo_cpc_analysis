"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  previewRows: unknown[][];
  headerRowIndex: number;
  onChange: (idx: number) => void;
}

/**
 * Shows the first ~15 rows of the parsed sheet in a compact table.
 * The currently selected header row is highlighted. Clicking a different
 * row promotes it to header.
 */
export default function HeaderRowPicker({
  previewRows,
  headerRowIndex,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!previewRows.length) return null;
  const maxCols = Math.max(...previewRows.map((r) => r.length));
  const cols = Array.from({ length: Math.min(maxCols, 12) });

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
      >
        <span>
          헤더 행:{" "}
          <strong>{headerRowIndex + 1}번째 행</strong>{" "}
          <span className="text-neutral-500">(자동 감지, 클릭해서 변경 가능)</span>
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="overflow-auto border-t border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-xs font-mono">
            <thead className="bg-neutral-50 dark:bg-neutral-900/60 text-neutral-500">
              <tr>
                <th className="p-2 w-8 text-center">#</th>
                {cols.map((_, ci) => (
                  <th key={ci} className="p-2 text-left font-normal">
                    col {ci + 1}
                  </th>
                ))}
                <th className="p-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => {
                const isHeader = i === headerRowIndex;
                return (
                  <tr
                    key={i}
                    onClick={() => onChange(i)}
                    className={cn(
                      "cursor-pointer border-t border-neutral-200 dark:border-neutral-800",
                      isHeader
                        ? "bg-emerald-50 dark:bg-emerald-950/30 font-medium"
                        : "hover:bg-neutral-50 dark:hover:bg-neutral-900/60",
                    )}
                  >
                    <td className="p-2 text-center text-neutral-500">{i + 1}</td>
                    {cols.map((_, ci) => {
                      const v = row[ci];
                      const s = v == null ? "" : String(v);
                      return (
                        <td key={ci} className="p-2 truncate max-w-[140px]" title={s}>
                          {s || <span className="text-neutral-400">∅</span>}
                        </td>
                      );
                    })}
                    <td className="p-2 text-right">
                      {isHeader ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <Check size={12} /> 헤더
                        </span>
                      ) : (
                        <span className="text-neutral-400">클릭</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
