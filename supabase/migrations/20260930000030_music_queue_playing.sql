-- -----------------------------------------------------------------------------
-- A queue says whether its host is playing, not just where they are
-- -----------------------------------------------------------------------------
-- Run this whole file with `npm run db:push`. It is idempotent: running it twice changes nothing the
-- second time, and it drops no row. It adds one column and touches no existing value.
--
-- Why: a follower worked out that the host had paused from *silence* - a row nobody had written for ten
-- seconds - because the row had no way to say it. So a host's pause reached followers ten seconds late,
-- and they then rewound to where the host had stopped. With the flag, the pause write itself says so
-- and a follower stops within a beat.
--
-- `default true` keeps every existing row (and any client not yet sending the flag) reading as it did:
-- playing, with silence still the fallback signal. Row Level Security is already on for this table and
-- its policies are per-row, so a new column needs no new policy - only the owner can write it.

alter table public.music_queues add column if not exists is_playing boolean not null default true;
