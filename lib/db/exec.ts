import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Execute arbitrary SQL (DDL) via the `public.exec_sql(text)` RPC function.
 * The RPC is SECURITY DEFINER and only service_role can call it.
 */
export async function execSQL(sql: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("exec_sql", { sql });
  if (error) {
    throw new Error(`exec_sql failed: ${error.message}`);
  }
}

/**
 * Execute long-running DDL (CREATE INDEX on big tables, etc.) via `public.exec_ddl`,
 * which sets `statement_timeout = 0` on the function body so it won't be killed
 * by the authenticator role's default 8 s timeout.
 */
export async function execDDL(sql: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("exec_ddl", { sql });
  if (error) {
    throw new Error(`exec_ddl failed: ${error.message}`);
  }
}

/**
 * Execute a SELECT via `public.exec_query(text)` RPC and return rows as typed array.
 */
export async function execQuery<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin().rpc("exec_query", { sql });
  if (error) {
    throw new Error(`exec_query failed: ${error.message}`);
  }
  return (data as T[]) ?? [];
}

/**
 * Long-running SELECT via `public.exec_query_long` — sets statement_timeout = 300s
 * so heavy aggregates on multi-million-row tables don't die on the authenticator
 * role's default 8 s timeout. Use for chart aggregates / distinct-value queries
 * on big tables; keep `execQuery` for small / bounded queries.
 */
export async function execQueryLong<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin().rpc("exec_query_long", { sql });
  if (error) {
    throw new Error(`exec_query_long failed: ${error.message}`);
  }
  return (data as T[]) ?? [];
}

/**
 * Retry a PostgREST operation that might fail while the schema cache is reloading
 * (happens right after CREATE/ALTER TABLE). Retries with linear backoff on PGRST205.
 */
export async function withSchemaRetry<T>(
  fn: () => Promise<{ error: { code?: string; message: string } | null; data?: T }>,
  attempts = 6,
): Promise<T | null | undefined> {
  for (let i = 0; i < attempts; i++) {
    const res = await fn();
    if (!res.error) return res.data;
    const msg = res.error.message.toLowerCase();
    const isCache =
      res.error.code === "PGRST205" ||
      msg.includes("schema cache") ||
      msg.includes("could not find the table") ||
      msg.includes("could not find the") && msg.includes("column");
    if (!isCache || i === attempts - 1) {
      throw new Error(res.error.message);
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return undefined;
}
