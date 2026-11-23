-- Kept pages as things (SPEC-seeing-machine.md, answer 13; Luke's typed yes, 2026-11-23: "you have the database okays make sure nothing is waiting
-- on me"). In plain words: three lists of allowed words each get one more. Letters and recommendations may hold a 'page'; the moderators' log may say a
-- 'page' or a 'note' was hidden. No row changes, and everything allowed before still is. Safe to run again.
alter table public.letter_items drop constraint if exists letter_items_kind_check;
alter table public.letter_items add constraint letter_items_kind_check check (kind in ('web', 'media', 'kino', 'thread', 'post', 'lore', 'file', 'song', 'profile', 'link', 'highlight', 'page'));
alter table public.recommendation_items drop constraint if exists recommendation_items_kind_check;
alter table public.recommendation_items add constraint recommendation_items_kind_check check (kind in ('web', 'media', 'kino', 'thread', 'post', 'lore', 'file', 'song', 'profile', 'link', 'highlight', 'page'));
alter table public.moderation_log drop constraint if exists moderation_log_target_kind_check;
alter table public.moderation_log add constraint moderation_log_target_kind_check check (target_kind in ('thread', 'reply', 'profile_comment', 'room_line', 'account', 'report', 'page', 'note'));
