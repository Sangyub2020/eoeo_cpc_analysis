-- Change-history entries per report type. Each entry has a date, a free-form note,
-- and optional screenshot URLs (pointing at objects in the report-screenshots bucket).

create table if not exists public.report_history (
  id              uuid primary key default gen_random_uuid(),
  report_type_id  uuid not null references public.report_types(id) on delete cascade,
  entry_date      date not null default current_date,
  note            text not null default '',
  screenshots     text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_report_history_type_date
  on public.report_history(report_type_id, entry_date desc, created_at desc);

alter table public.report_history enable row level security;

-- Public storage bucket for screenshots. Files are uploaded by service_role
-- (bypasses RLS); reads are public via the bucket.public flag.
insert into storage.buckets (id, name, public)
values ('report-screenshots', 'report-screenshots', true)
on conflict (id) do nothing;
