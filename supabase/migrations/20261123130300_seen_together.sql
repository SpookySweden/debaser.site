-- SEEN TOGETHER (SPEC-seeing-machine.md, idea x; Luke's typed yes, 2026-11-23: "you have the database okays make sure nothing is waiting on me"). In
-- plain words: people with an account who may read a live room may hear and say, on that room's own channel, which page is in front and how far down
-- it is. Nothing is stored: it is words passed between them as they happen. Two rules beside the room canvas's, worded as those are. Safe to run again.
drop policy if exists "seen together heard in a live room" on realtime.messages;
create policy "seen together heard in a live room" on realtime.messages for select to authenticated using (
  realtime.messages.extension = 'broadcast' and realtime.topic() like 'seeing:%' and not (select public.is_banned()) and not (select public.is_guest())
  and exists (select 1 from public.watch_rooms r where r.id::text = substr(realtime.topic(), 8) and r.ended_at is null)
);
drop policy if exists "seen together said in a live room" on realtime.messages;
create policy "seen together said in a live room" on realtime.messages for insert to authenticated with check (
  realtime.messages.extension = 'broadcast' and realtime.topic() like 'seeing:%' and not (select public.is_banned()) and not (select public.is_guest())
  and exists (select 1 from public.watch_rooms r where r.id::text = substr(realtime.topic(), 8) and r.ended_at is null)
);
