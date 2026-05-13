-- Per-brand event windows surfaced as overlays on every chart in the brand
-- dashboard. The user adds something like ("BS", 2026-03-03, 2026-03-07) and
-- it shows up as a shaded x-axis band on every chart that's a time series.
--
-- `brand` stores the display name (matches `campaign_nicknames.brand`), not
-- the slug — keeps the schema consistent and survives slug renames.

create table if not exists public.brand_events (
  id          uuid primary key default gen_random_uuid(),
  brand       text not null,
  name        text not null,
  color       text not null default '#22d3ee',
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_brand_events_brand_date
  on public.brand_events(brand, start_date);

alter table public.brand_events enable row level security;
