# MEDIA picks (Luke, 2026-11-04)

## What Luke asked for
- The MEDIA page never shows an empty list when nobody has searched; an algorithm sorts and recommends.
- Claude tags the media in batches.
- An option to bring in someone's YouTube, if they link Google.
- An IMDB key, above and centred over the SOURCE choices, that filters to KINO. The CYTUBE tab is now STREAM.

## Luke's answers
- Model: Claude Haiku 5.5 through the Message Batches API.
- YouTube: Google's API offers no real home page, so it's subscriptions and likes, opt-in.
- Database: one new table, `web_item_tags`, OK'd. Nothing existing is altered.

## How it behaves
- **Before searching, SOURCE ALL, BEST MATCH:** the saved items, ordered for the reader (`lib/web/recommend.ts`), under
  PICKED FOR YOU. DATE and POPULAR keep their own order.
- **Before searching, nothing saved under the filters** (KINO, or a TYPE with no rows): the page asks live sources about a
  word it chooses (the reader's strongest word, then a list per kind; KINO's are genres), leaving the box and address
  alone. Only when every word finds nothing does it say NOTHING TO SHOW HERE YET.
- **The order:** words the reader has opened, then creators, then a little for platform; freshness halves every 30 days;
  a daily jitter so the list changes by day but not within one. Repeats from one site or creator are marked down. Rows
  are ordered a page at a time, so LOAD MORE never moves what is on screen.
- **Tastes** are counts in that browser's storage (`taste-store.ts`), so they do not follow a person between devices. The
  opens saved on the server (`web_requests`) can't be read back per person, and that would need another database change.
- **Claude's words** only ever order a list. They are never shown. A job runs every three hours (`/api/web/tag`, cron
  `web-tag`), collecting the last batch and sending up to 200 new items, one batch out at a time. An item that fails
  three times stops being sent.
- **YouTube:** `[ LINK YOUTUBE ]` asks Google for read-only access. Up to 6 uploads and likes show under YOUR YOUTUBE and
  teach that visit's order. The token is used for one request from the person's own browser, and stored by neither us
  nor the server; the answer is kept in their browser for a week.

## Luke's steps (Claude can't do these; they involve his keys)
1. **Claude key:** Vercel, Project Settings, Environment Variables, `ANTHROPIC_API_KEY`, Production. Use a newly made key,
   then redeploy. Without it the job does nothing and the page sorts on the platforms' own tags.
2. **YouTube:** in Google Cloud, enable YouTube Data API v3 and add the `youtube.readonly` scope to the consent screen. In
   Supabase, enable manual linking under Authentication, so email accounts can link Google. Then add
   `NEXT_PUBLIC_GOOGLE_VIDEOS_LINK=on` to `.env.production`. Until Google verifies the app (listed at about 10 business days),
   people see an unverified-app warning and the project is capped at 100 new users, a cap Google does not reset.

## Out of scope
A real YouTube home page (Google offers none, and session cookies would give the server full account access). Tastes that
follow a person between devices.
