-- Privacy defaults for NEW accounts (list 2, group DEFAULTS, Luke's typed OK 2026-11-16): profile comments ON and
-- "listening" shown. Only column defaults change; no existing row is touched. Guest sign-ups take them too (hidden accounts).
-- Re-runnable.
alter table public.profiles alter column show_profile_comments set default true;
alter table public.profiles alter column hide_listening set default false;
