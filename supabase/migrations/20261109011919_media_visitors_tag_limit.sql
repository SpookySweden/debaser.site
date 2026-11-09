-- MEDIA opened to visitors (20261109003047_media_open_to_visitors.sql), one piece it missed (Luke's OK, 2026-11-09).
-- DISCOVER's map is built once and shared by every server (graph-shared.ts), whoever asked first. `web_tag_limit_reached`
-- (yes when tagging has spent its $60) was callable by signed-in people only, so a map built on a visitor's request lacked
-- the flag, and signed-in readers of /discover could then miss "TAGGING STOPPED" for up to 3 hours. Visitors may now ask it
-- too: it answers only true or false about the spend. Nothing else changes.
-- Re-runnable: grants revoked before given.

revoke all on function public.web_tag_limit_reached() from public, anon, authenticated;
grant execute on function public.web_tag_limit_reached() to anon, authenticated;
