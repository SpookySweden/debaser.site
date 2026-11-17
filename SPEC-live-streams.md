# SPEC: live streams from Twitch and YouTube in MEDIA and in rooms

Luke, 2026-11-17: "next up we are adding livestreams from twitch and youtube to be able to be accessed in the media page and
able to be queued up in a room etc, using our player and our everything".

Interviewed the same day. His answers, in his words where he added any:
1A, "also shows and prioritises user rooms, same formatting as other media results". 2: "lives mixed in". 3A. 4A. 5A. 6A.
7A, "however do reccomend twitch streams based on user history- linked youtube and tags and association and all other data
we have in the algorithm for reccmoendations". 8C. 9A. 10: "official api keys if they are permenenat and best".

Words used here: **a live** is a stream broadcasting now on Twitch or YouTube. **A live room** is one of this site's rooms
that has pressed GO LIVE (SPEC-rooms-perpetual.md). The two are different things; both show `● LIVE` because both are on now.

## What Luke will see

### MEDIA search
- **A `[ ● LIVE ]` key beside SORT.** On, a search lists only what is on right now: this site's live rooms first, then
  Twitch and YouTube lives mixed by best match. Typed, `is:live`. The address carries it (`?live=1`).
- **TWITCH is a SOURCE choice** (`in:twitch`), like YOUTUBE. With SOURCE TWITCH and the LIVE key off, it lists channels
  that are live now that match the words. Twitch's past broadcasts are not searched (out of scope, below).
- **SOURCE ALL mixes lives in**, each with a `● LIVE` mark where a video's length goes. YouTube lives stop being skipped
  (today `youtube-innertube.ts` and `youtube.ts` drop them on purpose). Upcoming broadcasts are still skipped.
- **This site's live rooms come first** (Luke: "prioritises user rooms"). A live room whose name, host or what's on matches
  the words is a row like any other MEDIA row: the picture of what is on (hotlinked, as the row it came from), what is on as
  the title, `<HOST>'S ROOM` where the maker goes, the `● LIVE` mark, and ROOM where the source goes. PLAY joins the room
  (a PASSWORD room asks for its password, as the ROOM list does). Only rooms the ROOM list already shows that reader appear:
  never a private room. No count of who is in it.
- **SORT** works as it does: BEST MATCH (default); POPULAR is the platform's own most-watched order, decided on our server
  and never shown, saved or sent (SPEC-web-sort.md's rule); DATE on lives is "started most recently first".
- **Twitch rows:** the stream's title, the channel's name as maker, the game or category in the row's words, Twitch's
  preview picture (hotlinked from Twitch's picture server), `● LIVE`, TWITCH as source. The keys a video row has: PLAY,
  `+ QUEUE`, and the rest that apply. Never a viewer count, follower count or rating.
- **Mature channels are shown like any other, unmarked** (Luke: 8C). Twitch's own player puts its own "mature audience"
  click-through over some channels; each viewer clicks it in Twitch's player (the room has no cover over Twitch's player,
  so the click reaches it).

### MEDIA's default feed (nothing searched)
- **Lives are mixed in** with the rest of the feed (Luke: "lives mixed in"), not a block of their own: a few in each block
  of 12, live rooms first among them. They come from the recommendations below, so they fit the reader.

### Recommendations (Luke: "reccomend twitch streams based on user history- linked youtube and tags and association and all other data")
- Twitch lives become candidates for FOR YOU's engine (`app/lib/recommender/engine.ts`, SPEC-recommender.md), scored the
  way it scores everything else, with a why-line in plain words and no scores leaving the engine. The candidates:
  - **Your history:** channels you have watched live here (HISTORY), asked whether they are live now.
  - **Your linked YouTube** (YOUR YOUTUBE, signed in with Google): the channels you watch and like there, looked up on
    Twitch by the same name; the topics YouTube files them under, matched to Twitch categories.
  - **Words and tags:** the words and tags your taste leans to (what you finished, opened, read), matched to Twitch
    categories and stream tags; the lives in those categories.
  - **Association:** one step out on the DISCOVER map, as the engine already does ("new", about 3 in 10).
- YouTube lives join the same way through the words of your taste (InnerTube live search).
- A signed-out visitor gets what the engine gives visitors today (their browser's own history, then the platforms' own
  most-watched order as the fallback, never shown).

### Rooms
- **Queue a live from MEDIA or by pasting its address**, the same `+ QUEUE` as any video. A Twitch channel queues as the
  channel (whatever it is broadcasting when its turn comes). A YouTube live queues as that broadcast.
- **The queue row shows the real title** from Twitch (today it says `<CHANNEL> ON TWITCH`, because there was no lookup).
- **It plays until somebody moves it on** (3A): a crown or the host presses NEXT, or the streamer ends, and then the room
  goes to the next thing by itself. Everyone is at the newest moment of the stream: the room already does this (LIVE where
  the time goes, no seek bar, pause and play with the host, back to the live edge after a pause).
- **Ended before its turn** (4A): a Twitch channel that is offline when its turn comes is skipped, and the room says
  `<CHANNEL> IS OFFLINE` where it says such things today. A YouTube live that has ended plays as its recording (YouTube turns
  a finished live into a normal video at the same address by itself), with a seek bar like any video.
- **Pasting an offline Twitch channel** is refused as today (`THAT CHANNEL IS OFFLINE`, the probe in `embeds.ts`).
- **Twitch's chat is not shown** (5A). The room's own chat is the chat.
- **Signed-out visitors** (6A): the same as signed in. They find and play lives in MEDIA, in their own browser-only room,
  and in anyone's live room they join. Today a visitor's own queue refuses Twitch (`THAT ONE PLAYS IN A LIVE ROOM ONLY`,
  `own-screen.ts` `soloRefusal`, because it asks the floating player, which has no Twitch); since list 3 a visitor's room
  opens in the room window, which has Twitch's player, so that refusal goes for Twitch.

### HISTORY (9A)
- One line per live watched, `● LIVE`, the stream's title, the channel as maker, how it reached you (as every line), and how
  long you watched (from when it started to when it stopped). Playing it again opens the channel live now, or says it is
  offline. A YouTube live played again is its recording. No new column: a live is a `video` play; how the mark is kept
  (the line's address form, `twitch:<channel>`) is settled in the build.

## The honest limits (said once)
- **"Our player" means our room around their player.** Ours: the room, its keys, its fullscreen with our background, the
  queue, chat, crowns, HISTORY, MEDIA's rows. Theirs: the picture plays in Twitch's or YouTube's own player inside the room.
  Taking their raw video stream (HLS) into our own player would break YouTube's terms ("access, reproduce, download... except
  as expressly authorized") and Twitch locks it behind a playback token its own site gets; it is not planned.
- **Twitch's own controls show on hover** and no setting hides them (Twitch's embed has no controls option; ROOMUI found the
  same). **Twitch plays its ads first**, unskippable. **Twitch asks for at least 400x300** to start by itself: a smaller
  player (the folded room's) may need a press.
- **The music bar's sound graph cannot read a live** (the relay reads a video's audio file; a live has none): it uses
  `[ HEAR ]` or moves gently.
- **Viewer counts never show** anywhere; they may order POPULAR on the server only.

## Where the data comes from
All read live, server-side, through `app/lib/web/safe-fetch.ts`; never saved into the WEB stream (`web_items`): a live is
over in hours. Cached on the server about a minute.

| Need | First | Fallback | Tested 2026-11-17 |
|---|---|---|---|
| Twitch: search, top lives, a category's lives, is a channel live | **Twitch's official API (Helix)** with Luke's app keys: `GET /helix/search/channels?live_only=true`, `/helix/streams` (`user_login`, `game_id`, up to 100 at once), `/helix/search/categories` | **Twitch's own site API** (`gql.twitch.tv`, the public web client id, no key), used when the keys are missing or Helix fails. Unofficial: it can change or be blocked without notice. Also answers browsers directly (it allows any site), if Twitch ever blocks our server | GraphQL from the desktop: top streams, search with live status, one channel, a category's streams, past broadcasts, all answered. Helix: not tested (no keys yet). Neither from Vercel's servers yet |
| Twitch pictures | `static-cdn.jtvnw.net/previews-ttv/live_user_<channel>-<w>x<h>.jpg`, hotlinked | Helix's own `thumbnail_url` (same server) | Live channel 200; offline channel redirects to Twitch's "offline" picture |
| YouTube lives | **InnerTube search** with the live filter (`params` `EgJAAQ==`), as MEDIA already searches YouTube | **YouTube Data API** `search.list?type=video&eventType=live` with the existing `YOUTUBE_API_KEY` (100 quota units a search of the daily 10,000) | InnerTube: lives returned, marked `BADGE_STYLE_TYPE_LIVE_NOW`, no length line |
| This site's live rooms | the watch repository's live-room list (mock and Supabase), as the ROOM list reads it | | |

Fields used from Twitch: channel login and name, stream title, game/category, tags, language, started time, picture.
Never sent to the browser: `viewer_count`. YouTube: id, title, channel, picture; never `concurrentViewers`.

## Keys Luke makes (Luke: "official api keys if they are permenenat and best")
- **Permanent:** yes. A Twitch app's Client ID never changes; its Client Secret works until Luke presses NEW SECRET. The
  server swaps them for a short pass (an "app access token", about two months) and fetches a new one by itself.
- **Best:** for Twitch, yes: documented, supported, its limits published (rate limited per app; ours is far under). The
  keyless route stays as the fallback. For YouTube the official API is *not* the best first choice (a live search costs 100
  of the 10,000 daily units, so about 100 searches a day), so YouTube keeps the site's pattern: InnerTube first, the key you
  already have as the fallback. No new YouTube key.
- **Luke's steps (Claude never types or sees the keys):**
  1. dev.twitch.tv/console, signed in to Twitch (it asks for two-step sign-in on the account), REGISTER YOUR APPLICATION.
  2. Name: anything (`debaser-site`). OAuth Redirect URL: `http://localhost`. Category: Website Integration. Client type:
     Confidential. CREATE.
  3. MANAGE on it: copy the Client ID; press NEW SECRET and copy the secret.
  4. Paste into `.env.local` on the desktop as `TWITCH_CLIENT_ID=` and `TWITCH_CLIENT_SECRET=`, and into Vercel (the
     project, Settings, Environment Variables, Production) under the same two names. The laptop's `.env.local` too, by hand.
- Until the keys are there, the build runs on the keyless route, so nothing waits on them.

## No database change
A queued live is a link like any other (`url`, `kind` `twitch` or `youtube`, `title`, and `webRef`), which the queue table
already holds. HISTORY keeps it as a `video` play. Rooms in results are read through the existing live-room list.

## How it is built (after Luke's OK)
Follows `.claude/skills/add-web-adapter` for the providers; both repositories (mock and Supabase) where a repository is touched.
1. **Providers.** `app/lib/web/search/providers/twitch.ts` (Helix, with the app token kept in the server's memory) and
   `twitch-site.ts` (the keyless GraphQL), one provider shape, Helix first. `twitch` becomes a search-only platform
   (`types.ts`, `PLATFORM_LABELS`, `WATCH_KIND_BY_PLATFORM` -> `twitch`, `hosts.ts` allows Twitch's picture server). YouTube:
   `youtube-innertube.ts` and `youtube.ts` gain a live mode (the live filter; `eventType=live`) and stop dropping lives in it.
   A `live` flag on the item; never a count.
2. **MEDIA.** The `[ ● LIVE ]` key and `is:live` (`web-filters.ts`), the TWITCH source, the `● LIVE` mark on rows, live rooms
   first (a row shape for a room; PLAY joins), lives mixed into the feed (`feed-mix.ts`).
3. **Rooms.** The real Twitch title at queue time; an offline channel at its turn is skipped with its line; a visitor's own
   queue takes Twitch (`soloRefusal`). Room players keep away from `floating-player.ts`.
4. **Recommendations.** Twitch and YouTube lives as engine candidates from history, YOUR YOUTUBE's channels and topics, taste
   words and tags, and DISCOVER's step out; why-lines.
5. **HISTORY.** The live line and replaying it.
6. **CLAUDE.md's MEDIA section** gains the lines: Twitch is a source (Helix with Luke's keys, the site API as fallback), lives
   are read live and never stored, rooms come first in LIVE results.

## How it is proved
- **Checks** (`Temp/check-live-*.cjs`, each seen failing without its code): the providers read saved answers from Twitch
  (Helix and GraphQL) and InnerTube into items with no count in them; nothing a browser receives from `/api/web/*` carries
  `viewer_count`/`concurrentViewers`; LIVE results put rooms first and never a private room; an offline Twitch entry is
  skipped; a visitor's queue takes a Twitch link; Helix is asked first and the site API only when Helix is missing or fails.
- **Locally, on mock data:** a mock live provider and the mock watch repository; a drive on a local dev server: the LIVE key,
  a room row first, PLAY joins, `+ QUEUE` a Twitch live, it plays with LIVE and no seek bar, an offline one is skipped, a
  visitor plays one in their own room, HISTORY's line. Real Twitch and YouTube players load on the local server (Twitch
  accepts `localhost` as the page's site).
- **On the live site:** `npm run deploy-status`, `npm run read` on `/media?live=1`, and one short read that Twitch answers
  from Vercel's servers (keyless, and Helix once the keys are in). No live drives.
- `npm run verify` and `npm run checks:changed` (the WEB checks) pass; the full `npm run checks` before the build starts
  (a SPEC feature).

## Risks
- **Twitch's site API is unofficial** and could start asking for a "client integrity" token (it already does for some
  things); Helix with Luke's keys is the answer, which is why it comes first.
- **Twitch or YouTube may refuse Vercel's servers** (YouTube often refuses data-centre servers for other things already):
  Twitch's site API also answers browsers, so the page can ask Twitch itself; YouTube falls back to the Data API key.
- **Mature channels unmarked** (8C) means a visitor can meet them in search; Twitch's own click-through is the only gate.
- **Ads before every Twitch live**, per viewer, can put people a little out of step at the start; the room already waits on a
  Twitch player that is loading rather than calling it refused.
- **More requests to Twitch** from recommendations (up to 100 channels per `/streams` call keeps it small).

## Out of scope
Twitch sign-in and "channels you follow" on Twitch (7A); Twitch's chat (5A); searching Twitch's past broadcasts and clips;
YouTube upcoming broadcasts; Kick and other live sites; playing any raw stream ourselves.

## Defaults taken (not asked; say if any is wrong)
- Rooms also come first in an ordinary ALL search, not only with the LIVE key on.
- A Twitch channel queues as the channel, a YouTube live as that one broadcast.
- Lives are cached about a minute on the server; nothing about them is stored.

## As built (2026-11-17)
- **The key** is `[ ● LIVE ]` to the right of ORDER, pressed it reads `● LIVE`; typed `is:live` (`is:all` clears it); the
  address carries `?live=1`. With no words it lists the most-watched lives on Twitch now (`/api/web/live`); YouTube needs words.
- **LIVE ROOMS** (`WebLiveRooms.tsx`) sits first under a search (ALL source, any or VIDEO kind, no creator), under the LIVE key,
  and at the top of the default feed; three rooms, then `[ ALL n ROOMS ]`. JOIN is the ROOM list's own (`enterRoom`).
- **The feed's LIVE place** is the fifth of each block of 12 (one FOR YOU place became it); empty, it is FOR YOU's again. A live
  is never rested or held back for being opened lately, so a channel watched here keeps coming back while it is live.
- **FOR YOU** has a LIVE NOW lane under YOUR YOUTUBE; its title key puts the live on in your room.
- **Recommendation asks** (`live-lane.ts`): the Twitch channels in your MEDIA history (newest first, not NOT FOR ME), then the
  makers your taste leans to and YOUR YOUTUBE's channels tried as Twitch logins of the same name, then your taste's 5 strongest
  words (Twitch categories, YouTube lives for the first two). Ordered: watched here first, then the taste score, then the day.
- **The room** says `<CHANNEL> IS OFFLINE` on the stage when Twitch's player says OFFLINE (not broadcasting, or the stream just
  ended), and the host's room moves on after the same pause as any link that won't play (`SKIPPED: <CHANNEL> IS OFFLINE`).
- **HISTORY** marks a Twitch channel's line `● LIVE` from its address, with the channel as maker and Twitch's preview as its
  picture; its fold says `A LIVE STREAM · ... · YOU WATCHED h:mm:ss`. A YouTube live's line is an ordinary video line (it is
  known to have been live only while it plays; played again it is the recording, as 4A says).
- **YouTube lives in an ordinary search** (changed in review): an ordinary search is cached a day on the server, so a YouTube
  live found there would go on saying LIVE long after it ended. So an ordinary (ALL or YOUTUBE) search still leaves YouTube
  lives out, as before; they show under the LIVE key, in the feed's LIVE places and FOR YOU's LIVE NOW, all read fresh.
  Twitch's rows are always live and always read fresh (a minute), so they do mix into ordinary searches.
- **POPULAR with Twitch's keys**: Helix's search has no counts, so `/streams` is asked for the found channels and orders them.
- **Never saved:** a live is not named for tagging, not asked for by the hourly save of opened rows, and YouTube's `videos.list`
  never makes a live into a saved item. Live answers are kept a minute in server memory (`live-fetch.ts`) and never by the browser.
- **Twitch's own overlay** shows the stream's title and viewer count ("Playing ... for 4,339 viewers") while its player is paused
  or hovered. That is Twitch's player, not our page, and no embed setting hides it; covering it would also block the click
  Twitch's mature-content warning needs. Luke, 2026-11-17: "Keep it".
- **Twitch's "network error (Error #2000)"** (Luke, 2026-11-17) is Twitch's player failing to reach its own stream server
  (usher.ttvnw.net): reproduced by refusing that address, as an ad blocker, VPN or filtering DNS can. Not Edge's Strict tracking
  prevention, not WebAssembly being off, not our frame (tested). What was ours: after 15 silent seconds the room called the link
  dead and laid a note over the whole stage that caught every press, so Twitch's own RELOAD could not be pressed. Now the note
  sits at the top, lets presses through, says TWITCH COULDN'T START THIS STREAM HERE with `[ WATCH ON TWITCH ↗ ]`, and goes
  away (nothing is skipped) the moment the stream plays. `scripts/probe-twitch-play.cjs` proves both, in Edge and Chrome.
- **Proof:** `scripts/check-web-search-twitch.cjs` (the provider, keys, cache, YouTube live mode, the key, the feed place, the
  asks); `scripts/drive-live.cjs` on a local mock server (`scripts/dev-mock-live.cjs 3317`).
