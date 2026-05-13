"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, X, Loader2, AlertCircle } from "lucide-react";
import type { BrandEvent } from "@/lib/reports/brand-events";

interface Props {
  brand: string;
  /** 부모가 이벤트를 같이 들고 있어서 모든 차트에 동일한 목록을 내려보내기 위함. */
  events: BrandEvent[];
  onChange: (events: BrandEvent[]) => void;
  /** 시작/종료 입력의 min/max — 공통 기간 슬라이더와 같은 범위로 묶는다. */
  minDate?: string;
  maxDate?: string;
}

const COLORS = [
  "#22d3ee", // cyan
  "#a855f7", // purple
  "#f59e0b", // amber
  "#10b981", // emerald
  "#f43f5e", // rose
  "#38bdf8", // sky
  "#fbbf24", // yellow
  "#e879f9", // fuchsia
];

export default function BrandEventsBar({
  brand,
  events,
  onChange,
  minDate,
  maxDate,
}: Props) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/brands/${encodeURIComponent(brand)}/events`, {
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.events)) onChange(j.events as BrandEvent[]);
      })
      .catch(() => {});
    return () => abort.abort();
    // brand 가 바뀔 때만 다시 fetch — onChange 가 매 렌더마다 새 함수라 의존성에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand]);

  async function addEvent() {
    setError(null);
    if (!name.trim()) {
      setError("이벤트 이름을 입력하세요");
      return;
    }
    if (!startDate || !endDate) {
      setError("시작일과 종료일을 모두 선택하세요");
      return;
    }
    if (endDate < startDate) {
      setError("종료일은 시작일 이후여야 합니다");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/brands/${encodeURIComponent(brand)}/events`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            color,
            start_date: startDate,
            end_date: endDate,
          }),
        },
      );
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "이벤트 추가 실패");
        return;
      }
      onChange([...events, j.event as BrandEvent].sort((a, b) =>
        a.start_date < b.start_date ? -1 : 1,
      ));
      setName("");
      setStartDate("");
      setEndDate("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "이벤트 추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(id: string) {
    setError(null);
    const prev = events;
    onChange(events.filter((e) => e.id !== id));
    try {
      const res = await fetch(
        `/api/brands/${encodeURIComponent(brand)}/events?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "삭제 실패");
        onChange(prev);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
      onChange(prev);
    }
  }

  return (
    <div className="px-2.5 py-1.5 rounded-md border border-purple-500/20 bg-slate-800/60 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-[11px] font-medium text-gray-300 shrink-0">
          이벤트
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름 (예: BS)"
          className="w-24 rounded border border-purple-500/30 bg-slate-900 px-1.5 py-0.5 text-[11px] text-gray-200 focus:border-cyan-500 focus:outline-none"
        />
        <input
          type="date"
          min={minDate}
          max={maxDate}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded border border-purple-500/30 bg-slate-900 px-1.5 py-0.5 text-[11px] text-gray-200 focus:border-cyan-500 focus:outline-none [color-scheme:dark]"
        />
        <span className="text-gray-500">~</span>
        <input
          type="date"
          min={minDate}
          max={maxDate}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded border border-purple-500/30 bg-slate-900 px-1.5 py-0.5 text-[11px] text-gray-200 focus:border-cyan-500 focus:outline-none [color-scheme:dark]"
        />
        <div className="inline-flex items-center gap-1 ml-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`색 ${c}`}
              onClick={() => setColor(c)}
              className={`w-4 h-4 rounded-sm transition-transform ${
                color === c
                  ? "ring-2 ring-offset-1 ring-offset-slate-900 ring-white scale-110"
                  : "hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={addEvent}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 text-[11px] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <CalendarPlus size={11} />
          )}
          추가
        </button>
        {events.length > 0 && (
          <span className="ml-auto text-[10px] text-gray-500">
            {events.length}개 · 모든 시계열 차트에 표시됩니다
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1 text-[11px] text-rose-300">
          <AlertCircle size={11} /> {error}
        </div>
      )}

      {events.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-purple-500/15">
          {events.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded text-[11px] border"
              style={{
                backgroundColor: e.color + "22",
                borderColor: e.color + "66",
                color: "#e5e7eb",
              }}
              title={`${e.start_date} ~ ${e.end_date}`}
            >
              <span
                className="inline-block w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: e.color }}
              />
              <span className="font-medium">{e.name}</span>
              <span className="text-gray-400 font-mono">
                {e.start_date.slice(5)}~{e.end_date.slice(5)}
              </span>
              <button
                type="button"
                onClick={() => removeEvent(e.id)}
                className="ml-0.5 p-0.5 rounded hover:bg-rose-500/20 text-gray-400 hover:text-rose-300"
                aria-label="삭제"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
