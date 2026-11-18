-- Removes the one row the live probe (scripts/probe-user-settings.cjs) left: TEST ACCOUNT A's user_settings row.
-- Luke's OK 2026-11-18 ("you have the okay"); db:backup 2026-11-18-17-00 taken first. Exactly one row, by its id.
delete from public.user_settings where person = '6d89898c-7aa3-47e1-9093-306faeac8679';
