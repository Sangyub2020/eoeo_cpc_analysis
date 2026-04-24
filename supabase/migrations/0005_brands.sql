-- Brand catalog + matching rules.
-- Enables splitting one uploaded CSV across multiple per-brand report_types
-- by matching campaign_name against registered rules.

create table if not exists public.brands (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,               -- 'kahi'
  display_name  text not null,                      -- 'KAHI'
  created_at    timestamptz not null default now()
);

create table if not exists public.brand_rules (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  match_type  text not null check (match_type in ('prefix','contains','regex')),
  pattern     text not null,
  priority    int  not null default 0,              -- higher wins on conflict
  created_at  timestamptz not null default now()
);
create index if not exists idx_brand_rules_brand on public.brand_rules(brand_id);
create index if not exists idx_brand_rules_priority on public.brand_rules(priority desc);

alter table public.brands      enable row level security;
alter table public.brand_rules enable row level security;

-- kind column on report_types: the logical "shape" (e.g. 'sp_search_term').
-- Slug format for brand-scoped types: {kind}__{brand_slug}.
alter table public.report_types add column if not exists kind text;
create index if not exists idx_report_types_kind on public.report_types(kind);
