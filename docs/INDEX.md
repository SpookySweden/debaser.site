# Index of SPECs and docs

Made by `node scripts/ctx.cjs --index`: do not edit by hand. A one-page digest of any topic: `node scripts/ctx.cjs <words>`.
Always loaded: `CLAUDE.md`, `.claude/rules/core.md`. Loaded when a file in the area is opened: the other rule files.
Sizes are rough tokens (characters / 4): read the sections you need, not the whole file.

## Rule files

| File | Loads | ≈ tokens |
|---|---|---|
| `.claude/rules/art.md` | when a file in its area is opened | 649 |
| `.claude/rules/backend.md` | when a file in its area is opened | 389 |
| `.claude/rules/browser.md` | when a file in its area is opened | 396 |
| `.claude/rules/core.md` | every session | 3161 |
| `.claude/rules/frontend.md` | when a file in its area is opened | 954 |
| `.claude/rules/media.md` | when a file in its area is opened | 2674 |

## Skills

- `.claude/skills/add-web-adapter`: The recipe for adding a new platform (Openverse, PeerTube, a podcast RSS feed, YouTube channel RSS...) to WEB, the media stream on the MEDIA page (/media, calle
- `.claude/skills/brief`: The DEBASER_OS template for starting another Claude session (a builder, a reader, a fresh coordinator) - the brief's shape, worktree and file ownership, notes f
- `.claude/skills/handoff`: The one shape for a DEBASER_OS session's hand-over and status note, the coordinator's notes, and wrapping up. Use when Luke says "wrap up", when the context hoo
- `.claude/skills/interview`: How to ask Luke anything on DEBASER_OS - an interview for a SPEC, a choice between approaches, a database or delete approval. Always the multiple-choice questio
- `.claude/skills/verify-site`: Run the full proof that a change is done - verify, the checks it can affect, capture + audit locally, then confirm the pushed commit is live on debaser.site and

## BROWSER

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-seeing-machine.md` | BROWSER, the DEBASER SEEING MACHINE | 9874 |
| `docs/seeing-machine-improvements.md` | BROWSER: what to make better next (the IMPROVE rounds, browser-fallback brief) | 3915 |
| `docs/seeing-machine.md` | BROWSER, the DEBASER SEEING MACHINE: how it is built | 6746 |

## MEDIA

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-book-editions.md` | every edition of every book (Luke, 2026-11-11) | 1697 |
| `SPEC-books.md` | books, audiobooks and the e-reader (Luke, 2026-11-10) | 1420 |
| `SPEC-discover.md` | DISCOVER and RECOMMENDED (Luke, 2026-11-05) | 5242 |
| `SPEC-kino-sources.md` | KINO: where else a title can be watched | 2230 |
| `SPEC-live-streams.md` | live streams from Twitch and YouTube in MEDIA and in rooms | 4949 |
| `SPEC-media-catalogue.md` | the media catalogue (`/media`) | 2455 |
| `SPEC-media-feed-v2.md` | MEDIA's default feed, version 2: a real ranking (FEEDALGO, 2026-11-17) | 4867 |
| `SPEC-media-feed.md` | MEDIA's default feed (Luke's second list, 2026-11-16) | 5761 |
| `SPEC-media-picks.md` | MEDIA picks (Luke, 2026-11-04) | 1447 |
| `SPEC-media-servers.md` | media servers in WEB (/web) | 1912 |
| `SPEC-reader.md` | the DEBASER reader (Luke, 2026-11-11) | 1368 |
| `SPEC-reading-places.md` | keeping your place in every book (Luke, 2026-11-13) | 1392 |
| `SPEC-recommendations.md` | recommendations (Luke, 2026-11-10) | 1199 |
| `SPEC-recommender.md` | FOR YOU, one recommender for the whole site (Luke, 2026-11-13) | 2649 |
| `SPEC-subtitles.md` | audio and subtitle languages, and a SUBS key in the stream room | 2053 |
| `SPEC-web-search.md` | WEB search everywhere (SPEC, 2026-10-31) | 3154 |
| `SPEC-web-sort.md` | WEB search sorting | 2029 |
| `SPEC-web.md` | ARCHIVE (/archive), called WEB (/web) until 2026-11-03 | 1800 |
| `docs/media-server-fill-in.md` | What to get from each friend | 428 |
| `docs/media-server-setup.md` | Putting your media server on debaser.site | 1348 |
| `docs/youtube-link-setup.md` | Switching on YOUR YOUTUBE (Luke's steps) | 912 |

## ROOMS

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-cytube.md` | the CYTUBE page, a blank GO LIVE and broadcaster looks (2026-11-03) | 2755 |
| `SPEC-floating-player.md` | Floating player and site arrows (Luke, 2026-11-05) | 1818 |
| `SPEC-guests.md` | Guests in streams | 1634 |
| `SPEC-music-queues.md` | music broadcasts become rooms that share the stream's queue (2026-11-03) | 1929 |
| `SPEC-room-chat-discuss.md` | room chat on the DISCUSS page (Luke, 2026-11-16) | 1174 |
| `SPEC-room-settings.md` | Room settings (Luke, 2026-11-05) | 592 |
| `SPEC-rooms-perpetual.md` | THE PERPETUAL ROOM (Luke's second list, ROOMMODEL; 2026-11-16) | 7457 |
| `SPEC-rooms-queues.md` | queues become rooms (Luke's list P1 and P2; answers of 2026-11-14) | 11307 |
| `SPEC-rooms-your-room.md` | YOUR ROOM LIKE THE LIVE ROOM, A ROOM WINDOW THAT LIFTS, AND BACKGROUNDS IN FULLSCREEN (Luke, 2026-11-16) | 3556 |
| `SPEC-screens.md` | SCREENS — sharing a screen in a room and controlling your own devices, on our own engine | 8490 |
| `SPEC-stream-art.md` | the room canvas ("magma mode") and STREAM ART in the archive (2026-11-03) | 1494 |
| `SPEC-stream-queue.md` | stream queue window, people's additions and crowns (2026-11-02) | 1795 |
| `SPEC-stream-series.md` | series in the stream room (2026-11-02) | 2157 |
| `SPEC-watch-links.md` | Watch together: links in the queue | 1265 |
| `SPEC-watch-together.md` | watch together (stream rooms) | 3245 |

## CHARACTERS

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-animate-ui.md` | Animator interface overhaul (Luke, 2026-11-06) | 1621 |
| `SPEC-animator.md` | ANIMATE (SPEC-animator.md) | 977 |
| `SPEC-character-speech.md` | characters speak (Luke, 2026-11-14) | 4088 |
| `SPEC-companion.md` | a companion character along the bottom of the site (Luke, 2026-11-13) | 2225 |
| `SPEC-pixel-render.md` | Dead Cells-style live pixel render + friendlier workbench | 1486 |
| `SPEC-profile-characters.md` | characters living on profile pages (Luke, 2026-11-13) | 1481 |
| `SPEC-simple-figures.md` | Simple figures (5-shape characters, node-anchored placement, sag) | 1883 |
| `SPEC.md` | Character creator overhaul ("canvas window") | 1265 |
| `docs/animate-credits.md` | ANIMATE: credits | 289 |
| `docs/animate-pen-list.md` | ANIMATE: try this with the pen | 1569 |
| `docs/character-figures.md` | Character workbench: simple figures | 1497 |
| `docs/character-render.md` | Character workbench: the live pixel render | 1065 |
| `docs/companion.md` | The companion | 5327 |
| `docs/profile-characters.md` | Characters on profiles | 4192 |

## FORUM

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-comic.md` | COMIC, the comic reader, lore links and the ARG (2026-11-20) | 5339 |
| `SPEC-forum-search.md` | Forum: HOT sort and Discord-style search | 1867 |
| `SPEC-forum-v2.md` | Forum v2, the board's keys working together (2026-11-17) | 2339 |
| `SPEC-forum-v3.md` | Forum v3, the rest of the vision (2026-11-17) | 2540 |
| `SPEC-history.md` | HISTORY (what you played, how it reached you, and when; 2026-11-17) | 5294 |
| `SPEC-letter-drag.md` | drag a letter onto a person (Luke, 2026-11-14) | 3132 |
| `SPEC-letters.md` | letters (Luke, 2026-11-10) | 1377 |
| `SPEC-live-docs.md` | live documents with a file browser (Luke, 2026-11-13) | 1592 |
| `SPEC-moderation.md` | Moderation: report, block, hide | 2608 |
| `SPEC-notifications.md` | notifications (NOTIFY, list 5, 2026-11-20) | 3469 |

## PEOPLE

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-privacy-decisions.md` | Privacy plan: Luke's decisions (2026-11-05) | 995 |
| `SPEC-privacy-phase-1.md` | Privacy, phase 1: the PRIVACY tab and new-account defaults | 880 |
| `SPEC-privacy-phase-2.md` | Privacy, phase 2: private streams | 1278 |
| `SPEC-privacy-phase-3.md` | Privacy, phase 3: what outsiders see | 1092 |
| `SPEC-test-accounts.md` | Hidden test accounts | 1047 |
| `SPEC-vanity.md` | VANITY, song settings panel, BARR (2026-10-31) | 2817 |

## LOOK

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-aquarium-settings.md` | AQUARIUM SETTINGS (Luke, 2026-11-15) | 3224 |
| `SPEC-backgrounds.md` | MORE BACKGROUNDS, AND AN EXPERIMENTAL SETTINGS WINDOW (Luke, 2026-11-15/16) | 3687 |
| `SPEC-beatbox-ui.md` | Beat box usability overhaul (Luke, 2026-11-06) | 2093 |
| `SPEC-less-text.md` | Less text, site-wide (2026-10-25) | 1172 |
| `SPEC-readability.md` | Readability pass ("Gnorp windows") | 1568 |
| `SPEC-tag-station.md` | TAG STATION (Luke, 2026-11-05) | 3099 |
| `SPEC-themes-marmalade.md` | the orange and green themes (MARMALADE, OVERDRIVE, TIGERBREAD, CLEMENTINE) | 4920 |
| `SPEC-windows.md` | Snapping, resizable windows (desktop) | 1654 |
| `docs/design.md` | DEBASER_OS design guide | 4784 |

## GAMES

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-leaguebot-live-champs.md` | LEAGUEBOT LIVE, pick any champion (2026-11-22) | 3319 |
| `SPEC-leaguebot.md` | LEAGUEBOT (League of Legends stats, scouting and advice; 2026-11-17) | 3452 |

## HOUSE

| File | What | ≈ tokens |
|---|---|---|
| `SPEC-command-center.md` | the command center (helper agents, an agent cap, CLAUDE.md split into rules) | 5015 |
| `SPEC-efficiency.md` | Efficiency pass ("say it once, say it short") | 5005 |
| `SPEC-self-hosting.md` | hosting DEBASER_OS from Luke's PC (self-hosting) | 8947 |
| `docs/STATE.md` | State of the site (the one current picture) | 1032 |
| `docs/commands.md` | Commands | 1041 |
| `docs/decisions.md` | Luke's standing decisions | 1396 |
| `docs/handoff-archive.md` | Older handoff notes, newest first | 22841 |
| `docs/sessions.md` | How sessions are run | 2939 |
| `docs/site-review-2026-11.md` | Site review, November 2026 | 2855 |

## OTHER

| File | What | ≈ tokens |
|---|---|---|
| `docs/how-this-works.md` | How the Claude sessions get their instructions (for Luke, 2026-11-27) | 1259 |
| `docs/theming.md` | Theming: how the look is changed | 2256 |

