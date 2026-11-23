-- BROWSER's visit record, written (SPEC-seeing-machine.md, D3; Luke's typed yes, 2026-11-23: "you have the database okays make sure nothing is
-- waiting on me"). In plain words: one function, which adds one row to browse_log (your account, the site's name, the time) for whoever calls it
-- and nobody else. The site's server calls it with the reader's own session before it looks at a page for them, and looks at nothing if it fails,
-- so no database key has to be given to the site. Nobody can read the table through it. Nothing existing is changed. Safe to run again.
create or replace function public.browse_log_write(p_site text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_guest() then raise exception 'sign in first' using errcode = '28000'; end if;
  if (select count(*) from public.browse_log b where b.person = auth.uid() and b.at > now() - interval '1 day') >= 5000 then
    raise exception 'too many' using errcode = '54000';
  end if;
  insert into public.browse_log (person, site) values (auth.uid(), lower(p_site));
end $$;
revoke all on function public.browse_log_write(text) from public, anon;
grant execute on function public.browse_log_write(text) to authenticated;
