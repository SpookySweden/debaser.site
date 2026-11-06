-- The index on a word's number goes (Luke's OK, 2026-11-06). Checked first: no function, view, foreign key or code looks a word up by its number, only by the word, and the index had no
-- reads for six hours of the job and readers. The numbers still come from the column's own counter. No rows or columns are touched. Re-runnable.
drop index if exists public.web_word_stats_id_idx;
