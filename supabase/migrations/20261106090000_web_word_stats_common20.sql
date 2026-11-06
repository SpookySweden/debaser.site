-- The common-words index covers only words on 20 or more items (Luke's OK, 2026-11-06): about 23,000 of 301,000 words, far more than the map reads (`pool()`, top 1,000, asks for
-- `items >= 20`). The new one is made before the old one goes, so that read never goes without. No rows or columns are touched. Re-runnable.
create index if not exists web_word_stats_common20_idx on public.web_word_stats (items desc, word) where items >= 20;
drop index if exists public.web_word_stats_common_idx;
