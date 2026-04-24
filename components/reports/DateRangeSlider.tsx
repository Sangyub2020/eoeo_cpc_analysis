"use client";

import { useRef } from "react";

interface Props {
  /** Earliest date the data covers (YYYY-MM-DD). */
  minDate: string;
  /** Latest date the data covers (YYYY-MM-DD). */
  maxDate: string;
  /** Currently-selected start date. Null = full range start. */
  fromDate: string | null;
  /** Currently-selected end date. Null = full range end. */
  toDate: string | null;
  onChange: (from: string, to: string) => void;
}

const DAY_MS = 24 * 3600 * 1000;

function parseDate(s: string): number {
  return new Date(s + "T00:00:00").getTime();
}
function fmtDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function snapToDay(ts: number, base: number): number {
  const days = Math.round((ts - base) / DAY_MS);
  return base + days * DAY_MS;
}

/**
 * Compact dual-handle date range slider. Uses refs for the latest from/to
 * values so the pointermove callback never reads a stale closure, which
 * was why earlier drag attempts dispatched onChange without moving data.
 */
export default function DateRangeSlider({
  minDate,
  maxDate,
  fromDate,
  toDate,
  onChange,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

  const minTs = parseDate(minDate);
  const maxTs = parseDate(maxDate);
  const span = Math.max(DAY_MS, maxTs - minTs);

  const from = fromDate ? Math.max(minTs, parseDate(fromDate)) : minTs;
  const to = toDate ? Math.min(maxTs, parseDate(toDate)) : maxTs;

  // Refs mirror the latest props so drag handlers always read the newest
  // from/to. onChange keeps the same identity across renders even though
  // parent passes an inline arrow — we read it through a ref too.
  const fromRef = useRef(from);
  const toRef = useRef(to);
  const onChangeRef = useRef(onChange);
  fromRef.current = from;
  toRef.current = to;
  onChangeRef.current = onChange;

  const leftPct = Math.max(0, Math.min(100, ((from - minTs) / span) * 100));
  const rightPct = Math.max(0, Math.min(100, ((to - minTs) / span) * 100));

  function tsAtClientX(x: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return minTs;
    const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return snapToDay(minTs + ratio * span, minTs);
  }

  function startDrag(handle: "from" | "to", ev: React.PointerEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    const onMove = (e: PointerEvent) => {
      const ts = Math.max(minTs, Math.min(maxTs, tsAtClientX(e.clientX)));
      if (handle === "from") {
        const nf = Math.min(ts, toRef.current - DAY_MS);
        onChangeRef.current(fmtDate(Math.max(minTs, nf)), fmtDate(toRef.current));
      } else {
        const nt = Math.max(ts, fromRef.current + DAY_MS);
        onChangeRef.current(fmtDate(fromRef.current), fmtDate(Math.min(maxTs, nt)));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onTrackPointerDown(ev: React.PointerEvent) {
    // Let the handle's own onPointerDown fire — it sets the right handle.
    if ((ev.target as HTMLElement).dataset.handle) return;
    ev.preventDefault();
    const ts = tsAtClientX(ev.clientX);
    const distFrom = Math.abs(ts - from);
    const distTo = Math.abs(ts - to);
    const handle: "from" | "to" = distFrom <= distTo ? "from" : "to";
    if (handle === "from") {
      onChange(fmtDate(Math.min(ts, to - DAY_MS)), fmtDate(to));
    } else {
      onChange(fmtDate(from), fmtDate(Math.max(ts, from + DAY_MS)));
    }
    startDrag(handle, ev);
  }

  const days = Math.round((to - from) / DAY_MS) + 1;

  return (
    <div className="w-full select-none flex items-center gap-2 text-[10px] text-gray-500 font-mono">
      <span className="shrink-0">{minDate}</span>
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <div className="text-center text-cyan-300 text-[10px] font-semibold truncate">
          {fmtDate(from)} ~ {fmtDate(to)}{" "}
          <span className="text-gray-500">({days}일)</span>
        </div>
        <div
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          className="relative h-1 rounded-full bg-slate-700/80 cursor-pointer"
        >
          <div
            className="absolute h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 pointer-events-none"
            style={{
              left: `${leftPct}%`,
              width: `${Math.max(0, rightPct - leftPct)}%`,
            }}
          />
          <span
            data-handle="from"
            onPointerDown={(e) => startDrag("from", e)}
            style={{ left: `${leftPct}%` }}
            title={fmtDate(from)}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 border border-slate-900 shadow shadow-cyan-500/40 cursor-grab active:cursor-grabbing touch-none"
          />
          <span
            data-handle="to"
            onPointerDown={(e) => startDrag("to", e)}
            style={{ left: `${rightPct}%` }}
            title={fmtDate(to)}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 border border-slate-900 shadow shadow-cyan-500/40 cursor-grab active:cursor-grabbing touch-none"
          />
        </div>
      </div>
      <span className="shrink-0">{maxDate}</span>
    </div>
  );
}
