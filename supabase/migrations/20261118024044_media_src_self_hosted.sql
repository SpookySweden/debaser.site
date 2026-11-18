-- The media catalogue's file links may also be on the self-hosted Supabase (SPEC-self-hosting.md, Stage 5).
-- Luke's OK 2026-11-18 ("Yes, widen it"). The site moved to Luke's PC: its files are served from https://api.debaser.site,
-- and links saved with the cloud's address are rewritten to it. The old rule accepted only supabase.co addresses, which
-- refused that rewrite and would refuse every new upload. supabase.co stays allowed, so going back to the cloud still works.
-- Safe to re-run.
alter table public.media_items drop constraint if exists media_items_src_is_ours;
alter table public.media_items add constraint media_items_src_is_ours check (
  src like '/assets/%'
  or src like 'https://%.supabase.co/storage/v1/object/public/%'
  or src like 'https://api.debaser.site/storage/v1/object/public/%'
);
