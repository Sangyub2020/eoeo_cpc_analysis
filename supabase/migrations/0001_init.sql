-- Amazon Advertising Dashboard — meta schema
-- Solo tool: service_role bypasses RLS, anon is locked out (RLS enabled, no policies).

create extension if not exists "pgcrypto";

-- =========================
-- report_types
-- =========================
create table if not exists public.report_types (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,         -- URL-safe id, e.g., "sp_campaign_daily"
  display_name  text not null,                -- shown in UI
  table_name    text unique not null,         -- real Postgres table name, e.g., "rpt_sp_campaign_daily"
  key_columns   text[] not null default '{}', -- column_name list that forms the UPSERT key
  created_at    timestamptz not null default now()
);

-- =========================
-- report_columns
-- =========================
create table if not exists public.report_columns (
  id              uuid primary key default gen_random_uuid(),
  report_type_id  uuid not null references public.report_types(id) on delete cascade,
  column_name     text not null,              -- snake_case db column name (sanitized)
  source_header   text not null,              -- original header from file (raw)
  data_type       text not null
                  check (data_type in ('text','numeric','integer','date','timestamp','boolean')),
  is_key          boolean not null default false,
  position        int  not null default 0,    -- display order
  created_at      timestamptz not null default now(),
  unique (report_type_id, column_name),
  unique (report_type_id, source_header)
);
create index if not exists idx_report_columns_type on public.report_columns(report_type_id);

-- =========================
-- report_uploads  (audit)
-- =========================
create table if not exists public.report_uploads (
  id              uuid primary key default gen_random_uuid(),
  report_type_id  uuid not null references public.report_types(id) on delete cascade,
  file_name       text not null,
  row_count       int  not null default 0,
  uploaded_at     timestamptz not null default now()
);
create index if not exists idx_report_uploads_type on public.report_uploads(report_type_id);

-- =========================
-- RLS: enabled but no policies -> only service_role can touch these.
-- =========================
alter table public.report_types    enable row level security;
alter table public.report_columns  enable row level security;
alter table public.report_uploads  enable row level security;

-- =========================
-- RPC for dynamic DDL (CREATE / ALTER / DROP TABLE).
-- SECURITY DEFINER so the function runs as its owner (service role in Supabase),
-- then we revoke from anon / authenticated and grant only to service_role.
-- =========================
create or replace function public.exec_sql(sql text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute sql;
  -- notify PostgREST so new/renamed tables become queryable via the REST API immediately
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

revoke all on function public.exec_sql(text) from public, anon, authenticated;
grant execute on function public.exec_sql(text) to service_role;
