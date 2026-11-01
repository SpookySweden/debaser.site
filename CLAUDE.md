@AGENTS.md

The house rules live in `.claude/rules/core.md` (loaded automatically).

## WEB (the /web panel, SPEC-web.md)
- Proof: `npm run verify` (lint, tokens, typecheck, the WEB checks, build) must pass.
- Changes go through the house loop in core.md (verify, checks, commit, push to main, `npm run read`).
- Metadata only: title, creator, plain-text description, thumbnail, date, kind, licence, duration.
  Never store or show likes, views, downloads, ratings, follower counts or comments.
- Index and link or embed. Never download, copy, transcode or re-host media; thumbnails are hotlinked,
  playback is the platform's own embed (asked to autoplay on our PLAY), an outbound link, or, for audio,
  the site's music bar streaming the platform's own file straight from the platform via a redirect
  (`app/lib/web/web-audio.ts`, Luke's OK 2026-10-31).
- Public APIs, RSS/Atom, oEmbed and open-data endpoints; unofficial JSON APIs a platform's own site uses
  (YouTube's InnerTube) are fine too, with an official fallback where one exists (core.md, "forever project").
  Never parse HTML pages.
- Remote fetches go through `app/lib/web/safe-fetch.ts`, never from browser code. Third-party text is
  rendered as plain text, never as HTML. Adding a platform: `.claude/skills/add-web-adapter`.
- /web is for signed-in people only: signed out it shows a sign-in prompt, the WEB routes refuse, and the
  media-server tables are unreadable to visitors (SPEC-media-servers.md).
- Luke's own and his friends' media servers are allowed sources, read from each server's list file
  (`app/lib/web/media-servers.ts`; friends' side: `docs/media-server-setup.md`). Each video plays from the
  server's own player; the site never stores, copies or transcodes video, and holds only images and audio as
  media itself. TMDB details (server-side, `TMDB_READ_TOKEN`) never include ratings, votes or popularity.
