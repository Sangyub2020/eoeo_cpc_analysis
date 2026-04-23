-- Companion to exec_sql. Runs a SELECT and returns rows as a jsonb array.
-- Used by the app for summary/aggregation queries that don't fit PostgREST's
-- built-in aggregate syntax (GROUP BY, window functions, arbitrary expressions).

create or replace function public.exec_query(sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || sql || ') t' into result;
  return result;
end;
$$;

revoke all on function public.exec_query(text) from public, anon, authenticated;
grant execute on function public.exec_query(text) to service_role;
