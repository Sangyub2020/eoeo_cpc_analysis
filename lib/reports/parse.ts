import * as XLSX from "xlsx";
import type { ParsedFile } from "./types";

/**
 * Parse CSV or xlsx file buffer.
 *
 * Auto-detects the header row in the first 15 rows using a scoring heuristic.
 * Needed because Excel pivot-table exports often have title/grouping rows above
 * the real header (e.g. row 1 = "Units sold", "(다중 항목)", "", ""; row 2 = the real labels).
 *
 * @param buffer  file contents
 * @param headerRowOverride  explicit row index (0-based) — bypasses auto-detection
 */
export function parseSpreadsheet(
  buffer: ArrayBuffer,
  headerRowOverride?: number,
): ParsedFile {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName)
    return { headers: [], rows: [], sampleRows: [], headerRowIndex: 0, previewRows: [] };

  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });

  if (!aoa.length)
    return { headers: [], rows: [], sampleRows: [], headerRowIndex: 0, previewRows: [] };

  const previewRows = aoa.slice(0, 15) as unknown[][];

  const headerRowIndex =
    headerRowOverride != null && headerRowOverride < aoa.length
      ? headerRowOverride
      : detectHeaderRow(aoa);

  const headerRow = aoa[headerRowIndex] as unknown[];
  const rawHeaders = headerRow.map((h, i) => {
    const s = h == null ? "" : String(h).trim();
    return s || `column_${i + 1}`;
  });

  // Dedupe headers
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h}_${n}`;
  });

  const rows: Record<string, unknown>[] = [];
  for (let i = headerRowIndex + 1; i < aoa.length; i++) {
    const rowArr = aoa[i] as unknown[];
    if (!rowArr || rowArr.every((c) => c == null || c === "")) continue;
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      row[h] = rowArr[idx] ?? null;
    });
    rows.push(row);
  }

  return {
    headers,
    rows,
    sampleRows: rows.slice(0, 10),
    headerRowIndex,
    previewRows,
  };
}

/**
 * Score each of the first 15 rows and return the one most likely to be the header.
 *
 * A good header row:
 *   - has many non-empty cells
 *   - cells are mostly strings, not numbers
 *   - the row *below* it looks like data (numeric-heavy)
 *
 * Returns the row index (0-based).
 */
export function detectHeaderRow(aoa: unknown[][]): number {
  const MAX_SCAN = Math.min(15, aoa.length);
  if (MAX_SCAN <= 1) return 0;

  let bestIdx = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < MAX_SCAN; i++) {
    const row = aoa[i];
    if (!row || row.length === 0) continue;

    let nonEmpty = 0;
    let stringCells = 0;
    let numericCells = 0;

    for (const c of row) {
      if (c == null || c === "") continue;
      nonEmpty++;
      const s = String(c).trim();
      if (!s) continue;
      if (isPureNumber(s)) numericCells++;
      else stringCells++;
    }
    if (nonEmpty === 0) continue;

    let score = 0;
    score += stringCells * 6;       // strong signal: headers are strings
    score -= numericCells * 4;       // numbers in a header row are a bad sign
    score += Math.min(nonEmpty, 12); // prefer rows with more filled cells (capped)

    // Look at the NEXT non-empty row — if it's mostly numbers, this is likely the header
    for (let j = i + 1; j < Math.min(i + 4, aoa.length); j++) {
      const next = aoa[j];
      if (!next) continue;
      let nextNumeric = 0;
      let nextNonEmpty = 0;
      for (const c of next) {
        if (c == null || c === "") continue;
        nextNonEmpty++;
        if (c instanceof Date) continue;
        if (isPureNumber(String(c).trim())) nextNumeric++;
      }
      if (nextNonEmpty > 0) {
        const ratio = nextNumeric / nextNonEmpty;
        if (ratio >= 0.5) score += 25;   // strong: data row below
        else if (ratio >= 0.25) score += 10;
        break;
      }
    }

    // Slight penalty for being the very first row IF other rows look good —
    // but not strong enough to mispick when row 0 is the legit header.
    // (We apply no penalty, just ensure ties break toward the later row when it scores equally.)

    if (score > bestScore || (score === bestScore && i > bestIdx)) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function isPureNumber(s: string): boolean {
  if (!s) return false;
  // Allow comma thousands separators and trailing %
  const cleaned = s.replace(/,/g, "").replace(/%$/, "");
  if (cleaned === "") return false;
  return !isNaN(Number(cleaned)) && Number.isFinite(Number(cleaned));
}
