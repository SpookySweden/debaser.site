-- YOUR OWN DEVICES' LINE (Luke, 2026-11-27: "when two of the same account are watching media in a room, make sure the pause play and
-- volume controls are all synced"). In plain words: a signed-in account may hear and say, on one live channel named after itself
-- ("account:<its own id>"), what its other devices should follow (today the room's speaker key: volume and mute). Nobody else may
-- hear it or send on it, guests and banned accounts never. Nothing is stored and no rows change: it is words passed between one
-- person's own devices as they happen (app/lib/watch/own-devices.ts). Two rules beside the room canvas's, worded as those are.
-- Safe to run again.
drop policy if exists "own device line heard by its account" on realtime.messages;
create policy "own device line heard by its account" on realtime.messages for select to authenticated using (
  realtime.messages.extension = 'broadcast' and realtime.topic() = 'account:' || (select auth.uid())::text
  and not (select public.is_banned()) and not (select public.is_guest())
);
drop policy if exists "own device line said by its account" on realtime.messages;
create policy "own device line said by its account" on realtime.messages for insert to authenticated with check (
  realtime.messages.extension = 'broadcast' and realtime.topic() = 'account:' || (select auth.uid())::text
  and not (select public.is_banned()) and not (select public.is_guest())
);
