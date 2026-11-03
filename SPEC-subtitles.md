# SPEC: audio and subtitle languages, and a SUBS key in the stream room

Luke, 2026-11-03: "make sure it also applies to series on internet archive and such. if the audio is one
language and the subtitles are another, make that clear too. if there is an option to change the subtitles,
include that into our player. if the piece of media has the option to change subtitles, make the subs: flag
have an arrow to the side which shows a pop up of all the sub languages available for that piece of media."

Builds on the language flags (commits 890e85e, 94009b2): `app/lib/web/language.ts` (which language, which
flag), `app/components/LanguageFlag.tsx`, `web_items.language`. Read those first. WEB is being renamed to
ARCHIVE (/web -> /archive) by another session on 2026-11-03: build on whatever has landed.

## Settled (Luke's answers, 2026-11-03)

| Question | Answer |
|---|---|
| Who picks subtitles in a stream room | **Each viewer for themselves.** The host's pick never changes anyone else's. Not synced, not stored in the room. |
| Archive subtitle files (archive.org sends no CORS header, so a page can't load them) | **Our server passes the text through**: fetched from archive.org when a viewer switches them on, converted SRT -> VTT if needed, handed to the player, **never stored**. Subtitle text only: never video or audio. Add this to CLAUDE.md's WEB rules as Luke's OK. |
| What happens when a video starts | **English subtitles on when the audio isn't English and English subtitles exist** (human-made first, else AUTO). A viewer can change or switch off at any time. |
| Subtitles burned into the picture | **`SUBS: [flag] IN PICTURE`, no arrow** (they can't be changed). Read from the title/description. |
| Where AUDIO / SUBS show | **Rows and the player.** Archive/search rows and stream-queue rows show the audio flag and, when known, a SUBS flag; the arrow pop-up and the switching live in the stream room's player bar. |
| Machine-made subtitles (YouTube auto, the Archive's `.asr.`) | **Included, marked AUTO**, listed after the human-made ones. YouTube's auto-*translate* languages are left out. |
| The platforms' own players on /archive rows (PLAY) | **Ask them to start with English subtitles** on foreign-language audio, where the player takes such a setting (YouTube `cc_load_policy=1&cc_lang_pref=en`, Vimeo `texttrack=en`, PeerTube `subtitle=en`). Their own CC menus stay as they are. |

## What Luke will see

- **A row** (archive stream, search, KINO, media servers, stream queue): today's single flag means the
  audio. When subtitles are known it becomes `AUDIO: [flag]  SUBS: [flag][flag][flag] +N`. English audio
  still shows no audio flag; English *subtitles* do show a flag (that is the useful part), so English needs
  a flag here: **GB, unless the tag names a region** (`en-US` -> US). Burned-in: `SUBS: [flag] IN PICTURE`.
- **The stream room's player bar**: a `SUBS: [flag] ▾` key beside QUALITY and the speaker, shown only when
  the playing video has switchable subtitles. The arrow opens a pop-up (the site's PopoutWindow / AboveAnchor
  pattern) listing every language: flag + name, human-made first, AUTO ones after with `AUTO`, and `OFF` at
  the top; the current one is pressed. Picking one changes only that viewer's player. ESC and a click outside
  close it. Burned-in subtitles show `SUBS: [flag] IN PICTURE` in the bar with no arrow.
- **Series** (an Archive item's episodes, a YouTube playlist, as folded blocks in the queue): the block wears
  the series' audio flag (Archive: the item's `language`; playlist: the playlist title, else most episodes'
  titles agreeing). Episodes inside show their own flags only where they differ from the block's. A viewer's
  SUBS pick carries on to the next episode of the same series; a different video starts from the default.

## Where each answer comes from

| Platform | Audio language | Subtitle list | Switching in our player |
|---|---|---|---|
| Internet Archive (single items and series) | item `language` (already read) | the item's files named `*.<lang>.vtt` / `*.<lang>.srt` (`.asr.` = AUTO), from `/metadata/<id>` (already read for series) | `<track>` elements on the room's own `<video>`, `src` = our pass-through route |
| YouTube | reading title + description (YouTube's search gives none) | the IFrame player's captions module: `getOption('captions','tracklist')` after `loadModule('captions')` | `setOption('captions','track',{languageCode})`; off = `unloadModule('captions')`. **Unofficial and undocumented**: say the risk once; fall back to hiding the key if the tracklist never arrives |
| Vimeo | none | player.js `getTextTracks()` (official) | `enableTextTrack(lang)` / `disableTextTrack()` |
| PeerTube | `language.id` (already read, checked against the text) | `GET /api/v1/videos/{uuid}/captions` (public) | the embed's `subtitle=<lang>` / its player API, where the room plays it |
| HLS / DASH files | none | the stream's own subtitle tracks (hls.js `subtitleTracks`, dash.js text tracks) | their APIs |
| Dailymotion, Twitch, other embeds, media servers | as today | none: no key | none (media servers play in their own players, with their own menus) |
| Burned in (any platform) | as today | words in the title/description: `subbed`, `eng sub(s)`, `english subtitles` -> en; `VOSTFR` -> fr; `legendado` -> pt; `subtitulado`, `sub español` -> es; `OmU`, `Untertitel` -> de; `sub ita` -> it; `napisy` -> pl | none |

Rows only show what is cheap to know: a list already in hand (the Archive series read, PeerTube captions
when asked for one row) or burned-in words. No extra platform request per search result. The full list is
asked for when the video plays.

## Server side

- `GET /api/web/subtitles?ia=<id>&file=<name>` (signed-in only, like every WEB route): checks the id and file
  name shape, confirms the file is a `.vtt`/`.srt` listed in that item's metadata, fetches it through
  `safe-fetch.ts` (archive.org hosts only, size cap ~512 KB, timeout), converts SRT -> VTT, answers
  `text/vtt` with a private cache header. Nothing written to disk or the database. Rate-limited per person.
  Cue text stays text (the browser's track renderer never treats it as HTML).
- The subtitle list for a played video: `GET /api/web/subtitles?list=...` returning `{ language, auto,
  source }[]`, or the client's own player APIs where the platform gives them in the page (YouTube, Vimeo).
- No database change is planned. If storing subtitle lists turns out to be needed, that needs Luke's typed OK.

## Edge cases to handle

- A subtitle language the player lists that `normaliseLanguage` can't read: shown by its own label, no flag.
- Two tracks in one language (e.g. human and AUTO English): both listed, AUTO marked.
- The host skips while a viewer's pop-up is open: the pop-up closes, the next video starts from the rule
  (or the series carry-over).
- A viewer who switched subtitles off keeps them off for the rest of that video, even if the host seeks.
- Phone width: the pop-up is a full-width sheet with 44px rows; the bar key never pushes the bar into two
  lines at 390px.
- Folded-away room (TV box): no key there; subtitles keep showing in the video.

## Out of scope

- Choosing the audio track (dubbed audio). YouTube's IFrame player can't, and the Archive has one track.
- Translating subtitles, or YouTube's auto-translate list.
- Uploading or editing subtitles.
- The forum and comms posts.

## Proof the build session owes

- A check (fails first) for: the burned-in word reader, the Archive file-name -> language reader (incl.
  `.asr.` -> AUTO), the default rule (foreign audio + English subs -> English on), SRT -> VTT conversion, the
  route refusing a file the item doesn't list and a host that isn't archive.org.
- A mock drive of the room: the SUBS key and pop-up at desktop and 390px, a pick changing only one browser,
  series carry-over; a real YouTube video with captions and a real Archive item with a `.vtt` driven in
  Edge (core.md's Playwright note: the in-app Browser pane draws YouTube's frame over everything).
- `npm run verify`, checks, audit, pushed, `deploy-status`, `read`.
