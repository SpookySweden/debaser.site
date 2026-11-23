-- BROWSER's visit record (SPEC-seeing-machine.md, D3; Luke's typed yes, 2026-11-23: "Yes add it").
-- One new table, browse_log: which account, which site (its name only, never the page or its address), and when. The site's server writes
-- it; nobody reads it through the site, signed in or not (Luke reads it in the database). Kept with no end date. A deleted account's rows
-- go with it. Nothing existing is changed, rewritten or deleted. Safe to run again.
create table if not exists public.browse_log (
  id bigint generated always as identity primary key,
  person uuid not null references auth.users (id) on delete cascade,
  site text not null check (char_length(site) between 1 and 253 and site = lower(site) and site !~ '[/?#@:[:space:]]'),
  at timestamptz not null default now()
);
create index if not exists browse_log_person_at on public.browse_log (person, at desc);

-- No policy at all: with Row Level Security on, nobody can read or write it but the server's own role, which it does not apply to.
alter table public.browse_log enable row level security;
alter table public.browse_log force row level security;
revoke all on public.browse_log from public, anon, authenticated;
revoke all on public.browse_log from service_role;
grant select, insert on public.browse_log to service_role;
comment on table public.browse_log is 'BROWSER: account, site name and time, written by the server only, read by Luke only (SPEC-seeing-machine.md, D3)';
