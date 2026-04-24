"use client";

import { useCallback, useRef } from "react";

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
 * Dual-handle date range slider. Compact single-row layout with a thin track.
 * Drag either handle to set from/to. Pointer listeners live on `window` (not
 * the handle itself) so capture doesn't swallow events before the global
 * handler can pick them up — that's what broke updates in the first pass.
 */
export default function DateRangeSlider({
  minDate,
  maxDate,
  fromDate,
  toDate,
  onChange,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"from" | "to" | null>(null);

  const minTs = parseDate(minDate);
  const maxTs = parseDate(maxDate);
  const span = Math.max(DAY_MS, maxTs - minTs);

  const from = fromDate ? Math.max(minTs, parseDate(fromDate)) : minTs;
  const to = toDate ? Math.min(maxTs, parseDate(toDate)) : maxTs;

  const leftPct = Math.max(0, Math.min(100, ((from - minTs) / span) * 100));
  const rightPct = Math.max(0, Math.min(100, ((to - minTs) / span) * 100));

  const tsAtClientX = useCallback(
    (x: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return minTs;
      const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      return snapToDay(minTs + ratio * span, minTs);
    },
    [minTs, span],
  );

  const beginDrag = useCallback(
    (handle: "from" | "to") => {
      draggingRef.current = handle;
      const onMove = (e: PointerEvent) => {
        if (!draggingRef.current) return;
        const ts = Math.max(minTs, Math.min(maxTs, tsAtClientX(e.clientX)));
        // Latest from/to values — read the captured closure variables, which
        // are re-created on every render because beginDrag depends on them.
        if (draggingRef.current === "from") {
          const nf = Math.min(ts, to - DAY_MS);
          onChange(fmtDate(nf), fmtDate(to));
        } else {
          const nt = Math.max(ts, from + DAY_MS);
          onChange(fmtDate(from), fmtDate(nt));
        }
      };
      const onUp = () => {
        draggingRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [from, to, minTs, maxTs, tsAtClientX, onChange],
  );

  const onTrackPointerDown = useCallback(
    (ev: React.PointerEvent) => {
      ev.preventDefault();
      const ts = tsAtClientX(ev.clientX);
      if ((ev.target as HTMLElement).dataset.handle) {
        // Click was on a handle — start dragging that specific one.
        beginDrag((ev.target as HTMLElement).dataset.handle as "from" | "to");
        return;
      }
      // Click on empty track — jump the nearest handle and start dragging it.
      const distFrom = Math.abs(ts - from);
      const distTo = Math.abs(ts - to);
      const handle: "from" | "to" = distFrom <= distTo ? "from" : "to";
      if (handle === "from") {
        onChange(fmtDate(Math.min(ts, to - DAY_MS)), fmtDate(to));
      } else {
        onChange(fmtDate(from), fmtDate(Math.max(ts, from + DAY_MS)));
      }
      beginDrag(handle);
    },
    [from, to, tsAtClientX, beginDrag, onChange],
  );

  const days = Math.round((to - from) / DAY_MS) + 1;

  return (
    <div className="w-full select-none flex items-center gap-2 text-[10px] text-gray-500 font-mono">
      <span>{minDate}</span>
      <div className="flex-1 flex flex-col gap-0.5">
        <div className="text-center text-cyan-300 text-[10px] font-semibold">
          {fmtDate(from)} ~ {fmtDate(to)}{" "}
          <span className="text-gray-500">({days}일)</span>
        </div>
        <div
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          className="relative h-1.5 rounded-full bg-slate-700/80 cursor-pointer"
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
            style={{ left: `${leftPct}%` }}
            title={fmtDate(from)}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 border border-slate-900 shadow shadow-cyan-500/40 cursor-grab active:cursor-grabbing"
          />
          <span
            data-handle="to"
            style={{ left: `${rightPct}%` }}
            title={fmtDate(to)}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 border border-slate-900 shadow shadow-cyan-500/40 cursor-grab active:cursor-grabbing"
          />
        </div>
      </div>
      <span>{maxDate}</span>
    </div>
  );
}
