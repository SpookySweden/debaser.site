-- The file index writes each new file's words straight in rather than saving them up (Luke's OK, 2026-11-06). Saved-up work came due inside the job's calls, ran past the API's 3 seconds a
-- statement, and stopped the job. A setting: no rows or data change. Re-runnable.
alter index public.web_pool_shards_words_idx set (fastupdate = off);
