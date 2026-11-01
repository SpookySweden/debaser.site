-- -----------------------------------------------------------------------------
-- Watch together: WEB items in the queue (SPEC-web.md, Phase 5, 2026-10-31)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`, AFTER 20261031134418_web_items.sql. Re-runnable: the one constraint is
-- dropped and re-created by name. No row changes, no new columns, no policy changes: every existing row
-- keeps its kind, and all seven old kinds stay allowed.
--
-- Adds one kind, `embed`: a WEB platform's own official player (the Internet Archive's, and later
-- PeerTube's or Openverse's), framed in a sandbox. The site never fetches, copies or re-hosts the media;
-- the address must be https on that platform's allow-listed host with its exact embed path. The browser
-- code checks that before every write and again before every frame (app/lib/web/official-embed.ts); this
-- table keeps its existing https and length checks (watch_queue_link_url), which still apply.

alter table public.watch_queue drop constraint if exists watch_queue_link_kind;
alter table public.watch_queue add constraint watch_queue_link_kind
  check (source_kind is null or source_kind in ('file', 'hls', 'dash', 'youtube', 'vimeo', 'dailymotion', 'twitch', 'embed'));
