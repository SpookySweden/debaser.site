-- -----------------------------------------------------------------------------
-- Watch together: video links in the queue (SPEC-watch-links.md, 2026-10-30)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Idempotent: columns are added if missing and each constraint is dropped and
-- re-created by name. No row changes: every existing row is a catalogue file and keeps its link columns
-- empty. The policies are untouched (any account adds unplayed rows in its own name; only the host
-- reorders, files plays and trims).
--
-- A queue row is now a catalogue file OR a link. Only the link's address, which kind of player it needs
-- and its title are stored; the site never fetches the video itself. A row can have neither once its
-- catalogue file has been removed (`media_item_id` is set null), which the record already shows.

alter table public.watch_queue add column if not exists source_url text;
alter table public.watch_queue add column if not exists source_kind text;
alter table public.watch_queue add column if not exists source_title text;

-- Never both a file and a link.
alter table public.watch_queue drop constraint if exists watch_queue_file_or_link;
alter table public.watch_queue add constraint watch_queue_file_or_link
  check (media_item_id is null or source_url is null);

-- A link has its kind and title; a file has neither.
alter table public.watch_queue drop constraint if exists watch_queue_link_complete;
alter table public.watch_queue add constraint watch_queue_link_complete
  check (
    (source_url is null and source_kind is null and source_title is null)
    or (source_url is not null and source_kind is not null and source_title is not null)
  );

-- https only (browsers block http video on an https page), and a sane length.
alter table public.watch_queue drop constraint if exists watch_queue_link_url;
alter table public.watch_queue add constraint watch_queue_link_url
  check (source_url is null or (source_url like 'https://%' and char_length(source_url) <= 2048));

alter table public.watch_queue drop constraint if exists watch_queue_link_kind;
alter table public.watch_queue add constraint watch_queue_link_kind
  check (source_kind is null or source_kind in ('file', 'hls', 'dash', 'youtube', 'vimeo', 'dailymotion', 'twitch'));

alter table public.watch_queue drop constraint if exists watch_queue_link_title;
alter table public.watch_queue add constraint watch_queue_link_title
  check (source_title is null or char_length(source_title) between 1 and 200);
