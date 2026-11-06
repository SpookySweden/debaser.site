-- The three new tables have no policy letting anybody read them; this says so for guests too, the way every other table does.
drop policy if exists "guests stay out" on public.house_account;
create policy "guests stay out" on public.house_account as restrictive for select to authenticated using (not (select public.is_guest()));
drop policy if exists "guests stay out" on public.house_account_gate;
create policy "guests stay out" on public.house_account_gate as restrictive for select to authenticated using (not (select public.is_guest()));
drop policy if exists "guests stay out" on public.account_restores;
create policy "guests stay out" on public.account_restores as restrictive for select to authenticated using (not (select public.is_guest()));
