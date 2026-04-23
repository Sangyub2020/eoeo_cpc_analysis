import type { DataType } from "./types";

export type AggFn = "sum" | "avg" | "min" | "max" | "count";

export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function aggregateRows(args: {
  rows: Record<string, unknown>[];
  xCol: string;
  yCols: { col: string; fn: AggFn }[];
  groupCol?: string;
}): Record<string, unknown>[] {
  const { rows, xCol, yCols, groupCol } = args;

  // key = xValue | groupValue
  type Bucket = { x: unknown; group: unknown; sums: Map<string, number>; counts: Map<string, number>; mins: Map<string, number>; maxs: Map<string, number> };
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const x = r[xCol] ?? null;
    const g = groupCol ? r[groupCol] ?? null : null;
    const key = `${String(x)}||${String(g)}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        x,
        group: g,
        sums: new Map(),
        counts: new Map(),
        mins: new Map(),
        maxs: new Map(),
      };
      buckets.set(key, b);
    }
    for (const { col } of yCols) {
      const n = toNumber(r[col]);
      if (n == null) continue;
      b.sums.set(col, (b.sums.get(col) ?? 0) + n);
      b.counts.set(col, (b.counts.get(col) ?? 0) + 1);
      b.mins.set(col, Math.min(b.mins.get(col) ?? Infinity, n));
      b.maxs.set(col, Math.max(b.maxs.get(col) ?? -Infinity, n));
    }
  }

  // Pivot group into separate series columns if groupCol set.
  // Output row shape: { [xCol]: x, [seriesName]: value }
  if (groupCol) {
    const xMap = new Map<string, Record<string, unknown>>();
    for (const b of buckets.values()) {
      const xk = String(b.x);
      let out = xMap.get(xk);
      if (!out) {
        out = { [xCol]: b.x };
        xMap.set(xk, out);
      }
      for (const { col, fn } of yCols) {
        const series = `${String(b.group)} · ${col}${fn === "sum" ? "" : `(${fn})`}`;
        out[series] = computeAgg(b, col, fn);
      }
    }
    return Array.from(xMap.values()).sort((a, b) =>
      String(a[xCol]) < String(b[xCol]) ? -1 : 1,
    );
  }

  // No group: series = y columns
  const out: Record<string, unknown>[] = [];
  const byX = new Map<string, Bucket>();
  for (const b of buckets.values()) byX.set(String(b.x), b);
  const xs = Array.from(byX.keys()).sort();
  for (const xk of xs) {
    const b = byX.get(xk)!;
    const row: Record<string, unknown> = { [xCol]: b.x };
    for (const { col, fn } of yCols) {
      const name = fn === "sum" ? col : `${col}(${fn})`;
      row[name] = computeAgg(b, col, fn);
    }
    out.push(row);
  }
  return out;
}

function computeAgg(
  b: { sums: Map<string, number>; counts: Map<string, number>; mins: Map<string, number>; maxs: Map<string, number> },
  col: string,
  fn: AggFn,
): number | null {
  const sum = b.sums.get(col);
  const count = b.counts.get(col);
  if (count == null) return fn === "count" ? 0 : null;
  switch (fn) {
    case "sum":
      return sum ?? 0;
    case "avg":
      return sum != null && count ? sum / count : null;
    case "min":
      return b.mins.get(col) ?? null;
    case "max":
      return b.maxs.get(col) ?? null;
    case "count":
      return count;
  }
}

export function isNumericType(t: DataType): boolean {
  return t === "numeric" || t === "integer";
}
