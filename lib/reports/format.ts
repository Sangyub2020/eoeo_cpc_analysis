/**
 * Format a value that looks like an ISO date/timestamp ("YYYY-MM-DD..." or
 * "YYYY-MM-DD HH:mm:ss+00") as "YY.MM.DD". Returns the original string if
 * the prefix doesn't match.
 */
export function fmtShortDate(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${m[1].slice(2)}.${m[2]}.${m[3]}`;
}
