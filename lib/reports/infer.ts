import type { DataType } from "./types";

/**
 * Return 'date' / 'timestamp' / null for a single value.
 * Accepts: Date objects, ISO strings, JS Date.toString() output, US/EU slash formats,
 * and anything else `new Date(s)` can parse *when the string is also date-looking*.
 */
function classifyAsDateLike(v: unknown): "date" | "timestamp" | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const iso = v.toISOString();
    // local-midnight dates imported via xlsx cellDates often have 00:00:00 in local tz;
    // fall back to 'timestamp' if not exactly midnight UTC
    return iso.endsWith("T00:00:00.000Z") ? "date" : "timestamp";
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < 6 || s.length > 80) return null;
  // Must have at least one date separator + digits pattern
  // (excludes bare numbers, short codes, etc.)
  const hasDateShape = /\d{1,4}[-\/. ]\d{1,2}[-\/. ]\d{1,4}/.test(s) || /\b\w{3}\s\d{1,2}\b.*\d{4}/.test(s);
  if (!hasDateShape) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // Has explicit time component?
  if (/\d{1,2}:\d{2}/.test(s)) return "timestamp";
  return "date";
}

export function inferDataType(values: unknown[]): DataType {
  const nonNull = values.filter((v) => v != null && v !== "");
  if (nonNull.length === 0) return "text";

  let allBool = true;
  let allInt = true;
  let allNum = true;
  let allDate = true;
  let allTs = true;

  for (const v of nonNull) {
    if (allBool) {
      const isBoolLike =
        typeof v === "boolean" ||
        (typeof v === "string" && /^(true|false|TRUE|FALSE|0|1)$/.test(v));
      if (!isBoolLike) allBool = false;
    }

    const kind = classifyAsDateLike(v);
    if (kind == null) {
      allDate = false;
      allTs = false;
    } else if (kind === "timestamp") {
      allDate = false;
    }
    // (if kind === "date", both allDate and allTs can stay true — dates are also valid timestamps)

    if (allNum) {
      // Reject dates from being classified as numeric
      if (v instanceof Date) {
        allNum = false;
        allInt = false;
      } else {
        const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
        if (!Number.isFinite(n)) {
          allNum = false;
          allInt = false;
        } else if (!Number.isInteger(n)) {
          allInt = false;
        }
      }
    }
  }

  if (allBool) return "boolean";
  if (allDate) return "date";
  if (allTs) return "timestamp";
  if (allInt) return "integer";
  if (allNum) return "numeric";
  return "text";
}

/**
 * Convert an arbitrary source header into a Postgres-safe snake_case identifier.
 * Result matches /^[a-z_][a-z0-9_]{0,62}$/ .
 */
export function normalizeHeader(h: string, fallbackIndex = 0): string {
  let s = h
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!s) s = `col_${fallbackIndex + 1}`;
  if (/^[0-9]/.test(s)) s = `c_${s}`;
  return s.slice(0, 63);
}

/**
 * Ensure all names in the list are unique, appending numeric suffixes where needed.
 */
export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n}_${count}`;
  });
}

/**
 * Coerce a raw cell value into the form Postgres expects for the given type.
 * Returns null for empty/invalid.
 */
export function coerce(value: unknown, type: DataType): string | number | boolean | null {
  if (value == null || value === "") return null;
  switch (type) {
    case "text":
      return String(value);
    case "integer": {
      const n =
        typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case "numeric": {
      const n =
        typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const s = String(value).toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
      return null;
    }
    case "date":
    case "timestamp": {
      if (value instanceof Date) return value.toISOString();
      const d = new Date(String(value));
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
  }
}
