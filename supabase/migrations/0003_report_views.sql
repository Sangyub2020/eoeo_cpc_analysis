-- Saved view snapshots (tab + chart config + filter state) per report type.

create table if not exists public.report_views (
  id              uuid primary key default gen_random_uuid(),
  report_type_id  uuid not null references public.report_types(id) on delete cascade,
  name            text not null,
  config          jsonb not null default '{}'::jsonb,
  position        int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_report_views_type on public.report_views(report_type_id, position, created_at);

alter table public.report_views enable row level security;
