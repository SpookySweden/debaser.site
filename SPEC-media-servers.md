# SPEC: media servers in WEB (/web)

Luke's interview, 2026-11-01. Build this in a fresh session. Read `SPEC-web.md`, the WEB section of
`CLAUDE.md` and `.claude/skills/add-web-adapter` first; this adds to them and changes them only where it says so.

## Goal
Media that Luke owns, and media on friends' hobby servers, shows inside the existing /web stream, fully
searchable, with TMDB details where TMDB knows the title. Vercel and Supabase hold no video, ever: only
metadata. Each video plays straight from the friend's (later Luke's own) server.

## Decisions (Luke's answers)
1. **Finding what's on a server: a list file.** Luke's friends already publish a list file with TMDB ids
   for their own things. FIRST STEP of the build: ask Luke for one friend's list address (or a sample
   file) and shape the parser to that real format. Don't guess the format and build against the guess.
2. **No duplicates.** One title found on several servers is ONE item with **SERVER 1 / SERVER 2 / ...**
   buttons. Matched by TMDB id (plus season/episode for TV); items without a TMDB id match only within
   one server. Switching server after pressing PLAY reloads the player from the new server, same title,
   nothing re-typed. If a server doesn't answer, say so in large plain words and offer the next server.
3. **(Reversed 2026-11-02, Luke: "remove the 'server 1 server 2' search parameters": servers are no SOURCE
   choices; their titles show in every search, and in KINO.)** **Each server is its own SOURCE choice** in the /web search (e.g. `in:sams-server`), named in code.
   Adding a server in code must add its SOURCE choice by itself, the way `SOURCE_OPTIONS` in
   `app/lib/web/web-filters.ts` already derives from `PLATFORM_LABELS`. A check proves it: add a fake server,
   see it offered.
4. **Signed-out visitors can't use the /web panel at all.** This changes WEB for everything, not just the
   media servers: today /web is public. Signed out, /web shows a sign-in prompt instead of the stream, the
   WEB search API routes refuse, and media-server rows are unreadable to anonymous database reads.
   Decide (and tell Luke) whether the header's WEB entry stays visible to signed-out visitors.
5. **TV: one entry per show**, with large Season and Episode pickers inside it, not one item per episode.
6. **Titles TMDB doesn't know** (friends' own hobby videos): fill the same fields the Internet Archive
   adapter fills (title, creator, plain-text description, thumbnail, date, kind, duration) from the
   list file's own data, sanitised the same way. Official/open endpoints only, still no HTML scraping;
   if the list lacks a field, the field stays empty.
7. **TMDB details** where a TMDB id exists: title, year/date, overview, poster, runtime, genres, and for
   shows the seasons/episodes. Server-side only, through `safe-fetch.ts`. Posters hotlinked from TMDB's
   image host, never copied. TMDB's required credit line shown where its details appear.
   Never store or show TMDB ratings, vote counts or popularity (the WEB metadata-only rule).

## Server list (in code)
- One file (e.g. `app/lib/web/media-servers.ts`) Luke edits: per server a name, its `https://` base, its
  list file address, and how to build a play address. Start with the placeholders
  `https://placeholder-server1.xyz` and `https://placeholder-server2.xyz`.
- The adapter rule "never fetch, frame or link a URL found in remote data" is kept by the podcast-style
  exception: a video or picture address from a list file is used only when it is on that same server's
  own listed host, re-validated; anything else is dropped.
- Player: the server's own player page in a sandboxed, no-referrer iframe, or a plain `<video>` for a
  direct file, whichever the real list format gives. Reader presses PLAY first (click-to-load, as now).

## Database (Luke's OK given 2026-11-01 for these tables)
- New tables for media-server items and their per-server copies (e.g. `web_media_titles`, keyed by TMDB
  id or server+id; `web_media_copies`, one row per server holding it). Only signed-in users can read
  them. Only the protected ingest route writes them (service role, as WEB ingest does now).
- Through migrations (`npm run db:new`, `db:push:dry`, `db:push`), re-runnable, RLS on every table.
  Before pushing, tell Luke in plain English what the migration creates.
- The hourly ingest reads every listed server's list file, the same way WEB reads its other sources.
- Mock AND Supabase repositories both get the new items (mock: a few clearly fake titles on two fake
  servers, one shared between them).

## Rule edits to make as part of the build
- `CLAUDE.md` WEB section and `SPEC-web.md`: Luke's own and his friends' media servers are allowed
  sources (via their list files); the site still never stores, copies or transcodes video, and holds only
  images and audio as media itself. /web is for signed-in people only.

## Accessibility (Luke's eyesight is poor; this is a main purpose of the site)
- Large, high-contrast server buttons and pickers, at least 44px, from the theme tokens. Plain words
  for every state (loading, server not answering, nothing found). Works at phone width, no sideways scroll.

## TMDB key (Luke sets it up, guided)
- Walk Luke through it step by step in plain English: account at themoviedb.org, Settings -> API, request
  a developer key, copy the **API Read Access Token**.
- Luke pastes it himself into `.env.local` (name it e.g. `TMDB_READ_TOKEN`) and into Vercel's environment
  variables (Production and Preview). Server-only: never a `NEXT_PUBLIC_` name. Claude never asks for the
  value, reads it back, prints it or commits it.
- Until the key exists, TMDB details are simply absent and the list file's own data is shown.

## Out of scope
- Reading friends' Jellyfin/Plex interfaces directly (needs keys that would reach the page).
- Any upload, copy, download or transcode of video.
- Ratings, views, likes, comments from anywhere.

## Proof
- `npm run verify`, `npm run checks`, capture + audit including /web.
- New checks, each proven to fail first: list-file parsing (with an off-host address being dropped),
  one title on two servers becomes one item, a new server appears as a SOURCE choice, signed-out /web and
  WEB API refused.
- Screenshots at desktop and phone width, signed in (TEST ACCOUNT A) and signed out; push to `main`,
  `npm run read` on the live /web.

## Notes for the build
- Sign-in hides entries on debaser.site only. A friend's file is still reachable by anyone who has its
  address; the friend's server has to protect it. Write a short guide for friends
  (`docs/media-server-setup.md`): https, allow debaser.site to frame the player, how to test.
- A standalone prototype of the player (server tabs, TMDB id, season/episode, auto-reload on server switch)
  was built and browser-tested in the cloud session; its behaviour is described above, rebuild it in the
  site's components and tokens.
