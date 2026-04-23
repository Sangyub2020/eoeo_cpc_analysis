import type { DataType } from "./types";

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export function assertIdent(name: string, label = "identifier"): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(name)}`);
  }
  if (name.length > 63) {
    throw new Error(`${label} too long (max 63): ${name}`);
  }
}

export function q(ident: string): string {
  assertIdent(ident);
  return `"${ident}"`;
}

export function pgType(t: DataType): string {
  switch (t) {
    case "text":
      return "text";
    case "numeric":
      return "numeric";
    case "integer":
      return "bigint";
    case "date":
      return "date";
    case "timestamp":
      return "timestamptz";
    case "boolean":
      return "boolean";
  }
}

/**
 * CREATE TABLE public.<tableName> (
 *   id bigserial primary key,
 *   upload_id uuid,
 *   <cols...>,
 *   [ unique (<keyColumns>) ]
 * )
 */
export function buildCreateTableSQL(
  tableName: string,
  columns: { name: string; type: DataType }[],
  keyColumns: string[],
): string {
  assertIdent(tableName, "table name");
  const inner: string[] = [
    `id bigserial primary key`,
    `upload_id uuid`,
  ];
  for (const c of columns) {
    inner.push(`${q(c.name)} ${pgType(c.type)}`);
  }
  if (keyColumns.length) {
    inner.push(`unique (${keyColumns.map(q).join(", ")})`);
  }
  return `create table if not exists public.${q(tableName)} (\n  ${inner.join(",\n  ")}\n);`;
}

export function buildAddColumnSQL(
  tableName: string,
  columnName: string,
  type: DataType,
): string {
  return `alter table public.${q(tableName)} add column if not exists ${q(columnName)} ${pgType(type)};`;
}

/** Escape a string value to be safely inlined as a SQL literal. */
export function sqlLit(v: string | number | boolean | null): string {
  if (v == null) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

export interface FilterShape {
  dateColumn?: string | null;
  dateFrom?: string | null; // YYYY-MM-DD
  dateTo?: string | null;   // YYYY-MM-DD
  dimensions?: Record<string, string[]>;
}

/**
 * Build a WHERE clause from a filter state, validating all identifiers against
 * the allowed column-name set. Returns "" if no conditions.
 */
export function buildWhereClause(
  filter: FilterShape,
  allowedColumns: Set<string>,
): string {
  const clauses: string[] = [];

  if (filter.dateColumn && allowedColumns.has(filter.dateColumn)) {
    assertIdent(filter.dateColumn, "date column");
    const col = q(filter.dateColumn);
    if (filter.dateFrom) clauses.push(`${col} >= ${sqlLit(filter.dateFrom)}::date`);
    if (filter.dateTo) clauses.push(`${col} < (${sqlLit(filter.dateTo)}::date + interval '1 day')`);
  }

  if (filter.dimensions) {
    for (const [col, vals] of Object.entries(filter.dimensions)) {
      if (!vals || !vals.length) continue;
      if (!allowedColumns.has(col)) continue;
      assertIdent(col, "filter column");
      const lits = vals.map((v) => sqlLit(v)).join(", ");
      clauses.push(`${q(col)} in (${lits})`);
    }
  }

  return clauses.length ? `where ${clauses.join(" and ")}` : "";
}

