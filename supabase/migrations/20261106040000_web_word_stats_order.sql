-- One index, so the map can read the commonest words quickly (Luke's OK, 2026-11-06). Without it that read sorted the whole table, took about 4.6 seconds, and timed out
-- on the live server. Adds no rows and changes no data. Re-runnable.
create index if not exists web_word_stats_common_idx on public.web_word_stats (items desc, word);
