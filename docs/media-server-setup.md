# Putting your media server on debaser.site

For friends who host their own media and want it to show on the MEDIA page (`debaser.site/media`, called WEB at
`debaser.site/web` until 2026-11-03), and later for Luke's own
server. The site lists what your server holds and plays it **from your server**. It never copies, downloads or
stores your videos: only the titles and, for films and shows, details and posters from TMDB.

This is for servers you and your friends run. Public film-lookup sites aren't added.

## What your server needs

1. **An https address**, e.g. `https://media.yourname.xyz`. Plain http isn't read.
2. **A list file, only if you want one.** Without one, the site asks your player page about each film and show someone finds on the MEDIA page, by its TMDB number, and shows a button for your server straight away if you have it. **Your player page must answer 404 for a title you don't have**: any other answer counts as having it. With one, only what you list shows, plus your own videos TMDB doesn't know, after the next hourly update. It sits at a fixed address on that same host, e.g. `https://media.yourname.xyz/debaser/list.json`.
   A JSON array, one entry per film and, for a show, one per episode or one for the whole show:

   ```json
   [
     { "title": "Example Movie", "type": "movie", "tmdb_id": "157336" },
     { "title": "Example TV Show", "type": "tv", "tmdb_id": "1399", "season": "1", "episode": "1" },
     { "title": "A whole show", "type": "tv", "tmdb_id": "4607" },
     { "title": "My short film", "type": "movie", "id": "my-short-film", "description": "Made in 2026.",
       "creator": "Your Name", "date": "2026-10-12", "duration": 754,
       "thumbnail": "https://media.yourname.xyz/pictures/my-short-film.jpg" }
   ]
   ```

   - `tmdb_id` (TMDB's number) is what lets the same film on two servers show once, and brings in TMDB's
     details.
   - **A show, one way or the other, not both:** an entry per episode with `season` and `episode` offers exactly those
     episodes. One entry with neither offers the whole show: viewers get every season and episode TMDB lists
     for it, so your player needs to answer all of them. A show entry with only one of the two numbers is dropped.
   - Things TMDB doesn't know: give an `id` (letters, digits, `.`, `_`, `-`) and whatever of `description`,
     `creator`, `date`, `duration` (seconds) and `thumbnail` you have. A missing field just stays empty.
   - A `thumbnail` must be on your server's own host, https, with no `?...` on the end, or it's ignored.
   - Anything else in an entry (like `provider`) is ignored.
3. **A player page** for each title, on the same host, at addresses built from a pattern, e.g.:
   - films: `/debaser/play/movie/{tmdb}` → `/debaser/play/movie/157336`
   - episodes: `/debaser/play/tv/{tmdb}/{season}/{episode}` → `/debaser/play/tv/1399/1/1`
   - a whole show (optional: your own page for it, with its seasons or playing from the start):
     `/debaser/play/tv/{tmdb}` → `/debaser/play/tv/1399`
   - your own videos (optional): `/debaser/play/item/{id}` → `/debaser/play/item/my-short-film`

   The page plays only things in your list. Tell Luke your patterns; they go in `app/lib/web/media-servers.ts`.
4. **Let debaser.site show the player in a frame.** Send this header on the player pages:

   ```
   Content-Security-Policy: frame-ancestors https://debaser.site https://debaser-site.vercel.app
   ```

   and don't send `X-Frame-Options: DENY` or `SAMEORIGIN` on them. The site loads your player sandboxed (scripts
   on your own origin only, no pop-ups, no forms, no navigating the page) and sends no referrer. If your player
   refuses to start in a sandbox, tell Luke: he can turn the sandbox off for your server alone (it still sends
   no referrer).
5. **Your front page answers.** Before playing, the site asks your server's front page (`https://your-host/`)
   whether it's up. Any answer counts, even a login page or a 404; no answer within 6 seconds reads as
   "NOT ANSWERING", and the reader is offered the next server.

## Privacy, honestly

- **The MEDIA page is public** (since 9 November 2026): anyone, signed in or not, can see which titles your server
  holds and press its button to open your player. Your list is still read by debaser.site's server, never by readers' browsers.
- But your list file and player pages are on your server: **anyone who learns their addresses can open them**.
  The site can't protect them for you. If that matters, protect the player pages on your side (your media
  server's own login works: a reader signs in to your server inside the player).
- The list file has to be readable without a login, because the site's hourly update fetches it. Keep in it
  only what you're happy for someone with the address to see.

## How to test

1. Open your list address in a browser: you should see the JSON array, nothing else.
2. Open one player address: it should play.
3. Check the frame header: `curl -sI https://your-host/debaser/play/movie/157336` should show the
   `Content-Security-Policy: frame-ancestors ...` line above.
4. Send Luke the three things: your https address, your list address, your player patterns. Your titles appear
   in the archive after the next hourly update: in every search, with a button for your server.
