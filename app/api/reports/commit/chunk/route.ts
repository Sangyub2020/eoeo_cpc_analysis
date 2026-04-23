import { NextResponse } from "next/server";
import { assertIdent } from "@/lib/reports/sql";
import { coerce } from "@/lib/reports/infer";
import type { DataType } from "@/lib/reports/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChunkPayload {
  upload_id: string;
  tableName: string;
  columnNames: string[];
  keyColumns: string[];
  dataTypes: DataType[];
  rows: unknown[][];
}

export async function POST(req: Request) {
  let payload: ChunkPayload;
  try {
    payload = (await req.json()) as ChunkPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { upload_id, tableName, columnNames, keyColumns, dataTypes, rows } = payload;
  if (!upload_id) return NextResponse.json({ error: "upload_id required" }, { status: 400 });
  if (!rows?.length) return NextResponse.json({ ok: true, inserted: 0 });
  if (columnNames.length !== dataTypes.length) {
    return NextResponse.json({ error: "columnNames/dataTypes length mismatch" }, { status: 400 });
  }

  try {
    assertIdent(tableName, "table name");
    columnNames.forEach((c) => assertIdent(c, "column"));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid identifier" },
      { status: 400 },
    );
  }

  let payloadRows = rows.map((rowArr) => {
    const out: Record<string, unknown> = { upload_id };
    columnNames.forEach((col, i) => {
      out[col] = coerce(rowArr[i], dataTypes[i]);
    });
    return out;
  });

  // Same-key-twice-in-one-statement violates ON CONFLICT DO UPDATE — dedupe (last-wins) per batch.
  if (keyColumns.length) {
    const seen = new Map<string, Record<string, unknown>>();
    for (const row of payloadRows) {
      const key = keyColumns.map((k) => String(row[k] ?? "\0")).join("\x1f");
      seen.set(key, row);
    }
    payloadRows = Array.from(seen.values());
  }

  try {
    await restInsertBatch({ tableName, rows: payloadRows, keyColumns });
  } catch (e) {
    return NextResponse.json(
      { error: `insert failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, inserted: payloadRows.length });
}

/**
 * POST rows directly to PostgREST with `Prefer: return=minimal` so the server
 * doesn't serialize the inserted rows back to us. Much smaller response than
 * supabase-js default. Includes retry for transient schema-cache misses after
 * CREATE/ALTER TABLE.
 */
async function restInsertBatch(args: {
  tableName: string;
  rows: Record<string, unknown>[];
  keyColumns: string[];
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL / SERVICE_ROLE_KEY missing");

  const url = new URL(`/rest/v1/${encodeURIComponent(args.tableName)}`, base);
  if (args.keyColumns.length) {
    url.searchParams.set("on_conflict", args.keyColumns.join(","));
  }
  const prefer = ["return=minimal"];
  if (args.keyColumns.length) prefer.push("resolution=merge-duplicates");

  const body = JSON.stringify(args.rows);
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer.join(","),
  };

  const MAX_ATTEMPTS = 8;
  // Transient HTTP statuses from Supabase/Cloudflare that warrant retry.
  // 429 = rate limit, 502/503/504 = gateway/unavailable/timeout, 522/524 = Cloudflare origin timeouts.
  const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504, 522, 524]);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body });
    } catch (e) {
      // Network error (connection reset, DNS blip, etc.) — retry with backoff
      if (attempt === MAX_ATTEMPTS - 1) throw e;
      await backoff(attempt);
      continue;
    }
    if (res.ok) return;

    const text = await res.text();
    const lower = text.toLowerCase();
    const isSchemaCache =
      res.status === 404 ||
      lower.includes("schema cache") ||
      lower.includes("pgrst205") ||
      lower.includes("could not find the table") ||
      (lower.includes("could not find the") && lower.includes("column"));
    const isTransient = TRANSIENT_STATUSES.has(res.status);
    const retryable = isSchemaCache || isTransient;

    if (!retryable || attempt === MAX_ATTEMPTS - 1) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    await backoff(attempt);
  }
}

/** Exponential backoff: 0.4s, 0.8s, 1.6s, 3.2s, 6.4s, 12.8s, 25.6s, 30s (capped). */
function backoff(attempt: number): Promise<void> {
  const ms = Math.min(30_000, 400 * 2 ** attempt);
  return new Promise((r) => setTimeout(r, ms));
}
