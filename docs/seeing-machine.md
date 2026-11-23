# BROWSER, the DEBASER SEEING MACHINE: how it is built

The plan and Luke's answers are `SPEC-seeing-machine.md`. This is what was built, what keeps it shut, and what works.

## Where things are
| What | Where |
| --- | --- |
| The page, tabs, keys, the frame's element | `app/browser/page.tsx`, `app/components/seeing/*` |
| Addresses, tabs, the frame's documents and messages, our script in it | `app/lib/seeing/address.ts`, `tabs.ts`, `frame.ts`, `hook.ts` |
| The keyboard: / the box, Alt+N a new tab, Alt+W close it, Alt+1 to 8 a tab (none while the page has the keyboard) | `app/lib/seeing/keys.ts`, listed on a new tab (`SeeingStart.tsx`) |
| A refusal said plainly: what it means, what may still be tried; every reason the server gives has its own words (a check reads them from its source) | `app/lib/seeing/refusals.ts`, `SeeingRefused.tsx` |
| Lenses, one file each | `app/lib/seeing/lenses/` |
| The server's eye from the browser | `app/lib/seeing/server-engine.ts` (asks `/api/see/*` and nobody else) |
| The server's eye | `app/lib/seeing/server/` (SERVER ONLY; `scripts/check-web-types.cjs` holds that), `app/api/see/*` |
| The guarded fetch | `safeFetchAnySite` in `app/lib/web/safe-fetch.ts`, its rules in `app/lib/web/public-address.ts`, its way out in `server/way-out.ts` |

## Settings (none needed; each read when a request arrives)
- `SEEING_MACHINE=off`: the server's eye off for everybody at once, pages already open included.
- `SEEING_OPEN=accounts`: opens it to everyone with an account (D2). Unset: the owner only (`SEEING_OWNER_ID`, else `SCREENS_OWNER_ID`).
  Luke's to set, and it opens nothing for anybody else until the visit record (D3) can be written (`server/visits.ts`: its table waits for his OK).
- `SEEING_EXIT`: `direct` (home), the only way out built.
- `SEEING_ASSET_ORIGIN`: `https://see.debaser.site` once that exists. Until then files come from the site itself, each answered with a
  policy that takes every right away (`assetHeaders`), so one opened by itself can do nothing.
- `SEEING_DEV_OPEN=1` and `SEEING_EXIT=fixture:<port>`: local drives only; a production build ignores both (held by the attack list).

## What keeps it shut
1. **The fetch.** A name or number is judged, looked up by 1.1.1.2 (which knows malware and phishing), every address it has is judged, and
   the connection goes to that same address and is hung up if it finds itself elsewhere. IPv4 only: the house has IPv6 addresses that look
   public. The house's own public address is asked of 1.1.1.1; unknown, nothing is fetched. Every redirect again from the start.
2. **The frame.** Two frames, each `sandbox="allow-scripts"`: no origin, no storage, no way to the session. The outer carries
   `frame-src 'none'`, so a page cannot take its frame to another address; the inner's policy loads our signed files and nothing else.
3. **What no policy in Chrome or Edge stops** is WebRTC (the `webrtc` directive is not read there) and a `<link>`'s hints (preconnect,
   dns-prefetch): each reaches another host straight from the reader's browser. So the hook takes WebRTC away, lets no frame be made (a frame
   is a fresh window with it back) and no link element either (a stylesheet a page links to is a style that imports it). `createElement` and
   its kin are covered, every way of writing markup goes through one Trusted Types policy the browser enforces, and addresses that are
   scripts are refused. That part runs in the page's own window, so it leans on nothing the page could put something else in place of.
   `scripts/drive-see.cjs --only eye` tries about 30 ways, then the same with each built-in taken from under it (the first version let 342
   frames through there: the security review, 2026-11-23), with a trap that counts a bare connection or packet as an escape. Firefox before
   its Trusted Types has the wrappers alone.
4. **Signed files.** An address in a page is a sealed pass (AES-GCM, the key made when the process starts): what, for whom, as what kind,
   for an hour. The address a person looks at is in no URL, and an altered pass opens nothing.
5. **The gate** reads the session token before anything else of a request. **Limits** are in `server/limits.ts`.
6. **Sign-ins** (D1): known sign-in hosts and banks are refused on every redirect (`server/sign-ins.ts`); a password box anywhere is dead.
7. **Pages that send people on**: three by themselves, eight when the reader is pressing things, in twenty seconds. A link from outside
   (`/browser#see=`) waits for GO.

## The rewriter reads tags, not a tree
`server/html.ts` reads HTML as a browser's tokenizer does and passes it through, changing tags as they go by, so a broken page stays as
broken as it was and the browser does the building. (The spec named parse5; this needs no dependency. parse5 remains the way to go if a page
is ever read wrongly.) The same tokens, as a plain tree, find READER's words. Scripts are changed in three ways only: module addresses are
signed, `location` is pointed at a stand-in (the frame's own address can be neither read nor moved), and no frame tag is left in their words.

## What works (server's eye, 2026-11-23, `scripts/see-table.cjs`, from home)
| Site | STANDARD | READER | Notes |
| --- | --- | --- | --- |
| Wikipedia article | whole | yes | |
| BBC News front | whole, pictures and menus | no main text (a front page) | |
| The Guardian front | whole | mostly links | some pictures over the 200-a-page limit |
| Hacker News | whole | yes | |
| GitHub repository | whole | the readme | |
| archive.org collection | blank | no | a one-page app that builds itself with modules made as it runs |
| old Reddit | refused | | Reddit sends servers to its sign-in page |
| Excalidraw (one-page app) | its frame, not the drawing board | no | needs storage and workers |
| FT (paywall) | its own "no" page (403) | | |
| YouTube video page | its shell, no video | no | video never passes through; the Room plays it (Phase 4) |
| X profile | the profile, not its posts | no | posts need sending requests, which scripts may not |
| Instagram | blank | no | the same |
| A 404 | shown, and the status line says so | no | |
| A redirect | followed, the box says where it ended | | |
| A PDF | refused: READ opens those | | |
| Small web (danluu.com) | whole | no main text (a list) | |
| Aozora (Shift_JIS) | whole | yes | |
| accounts.google.com | refused, always | | D1 |

## Lenses and tools (Phase 3)
One file each in `lenses/`; a lens is a stylesheet (`css`), what it needs done to the page (`tools`, acted on by `hook.ts`, each undone when the
next dressing doesn't ask for it), and a panel. X-RAY, LOW-FI (five palettes), DYE (colours to the theme's dyes, 4.5:1 kept, pictures dithered on a
canvas), GLASS (`html[data-see-glass]` clears the site window; the backgrounds run while it is on), CUSTOM (ten blocks, shared as `SEE:words+mono`).
SEAM and LOUPE are a second drawing of the page, clipped. ERASE keeps selectors of one shape (`isSelector`) per site; SITE MEMORY keeps a lens per
site (`memory.ts`, this browser only until Phase 5). TIME DIAL: the Internet Archive's copy nearest a year. SCAN: wiby.me's own random page.
Proof: `drive-see.cjs --only lenses` (DYE and GLASS measured on every theme, 5.51:1 or better).

## Media, SEE and the extension (Phase 4)
- **The tray** (`[ MEDIA n ]`): what a page plays or says it plays (`server/media.ts`; scripts' own additions by `hook.ts`), read by the Room's own rules
  (`lib/seeing/media.ts`, `recognizeLink`, `queueRefusal`). Rung 1 a platform's player, rung 2 a file or stream (a file is proved by
  `probeVideoLink` first), rung 5 its own page only, with the reason. Rung 3 (a page's declared player framed in the Room, NOT IN STEP) needs a new
  kind of queue row, so it waits for a database change; rung 4 waits for SCREENS' relay.
- **`[ SEE ]`** (`SeeKey`) beside outside links in posts, comms, letters and MEDIA's reading rows, for people whose bar has BROWSER on it.
- **The extension** (`extension/`, how to put it in: its README): OWN EYE. Its own page frames a site the reader has ADDED, with its cookies, in the
  theme the site told it; a panel beside an ordinary tab has the same lenses. It asks for no site when it is put in. The no-framing header is
  lifted by a session rule that names the machine's tab, the machine or an added site as the asker, and added sites only, never a sign-in; it goes
  when the machine's page does. `Temp/check-see-extension.cjs`, `scripts/drive-see-extension.cjs` (26, pretend sites, signed in to nothing).

## Search (Luke, 2026-11-23: "a list of multiple search engines such as Google, bing and your best ideas")
- `search.ts` (pure), `search-store.ts`, `SeeingEngines.tsx`. Words that are not an address go to the chosen engine; a line under the box says which of
  the two GO will do. Letters first ask an engine once (`w fog`, `!g fog`); `!` shows the list; ALL asks three, a tab each; a results page offers the
  same words of the others (ASK); SEARCH THIS takes a selection. An engine can be off, moved, or added by hand (https, one `%s`, no inside names).
- Results are a page like any other: shown through a lens, never read into anything of ours. A bot check or a consent wall is never worked round: such
  an engine opens in OWN EYE, or a new tab (↗). READER shows a list of results as a list.
- In the server's eye an engine sees the house's address; in OWN EYE or a new tab, the reader's. Nothing searched for is kept on the server:
  `browse_log` is a site's name (checked).

Each tried once in the server's eye, 2026-11-23 (`scripts/see-table.cjs --engines`):

| Engine | Server's eye | Opens |
| --- | --- | --- |
| DuckDuckGo (plain HTML) | results | here, and the first choice |
| Marginalia, Wiby, Wikipedia, Wiktionary, arXiv (slow), GitHub, Wikimedia Commons | results | here |
| Google | a page asking for scripts it won't run here | ↗ |
| Bing, Mojeek | a bot check | ↗ |
| Brave (429), Ecosia (403), Openverse (403) | refused | ↗ |
| Startpage, Qwant, Internet Archive, YouTube, MDN, Wayback Machine | its shell, no results | ↗ |
| Stack Overflow | sends servers on to a check | ↗ |
| Open Library | did not answer in time | ↗ |

In OWN EYE these are your own browser's, where they answer as they always do; not tried here, where nobody is signed in to anything.

## The EXTENSION window, and how it is kept up to date (Luke, 2026-11-23)
- Under the profile's `[ ⚙ SETTINGS ]`: `ExtensionWindow.tsx`. Without the extension it gets it first (the download), with an old one it updates it
  first, and only with the newest are there settings. OWN EYE opens it when it is missing or old. Silence is "not here".
- **What is served** is made when the site is built, from `extension/` (`server/extension-files.ts`): `/api/extension/zip`, `/list` (a SHA-256 of each
  file), `/file/<name>` (plain text). A change to `extension/` needs a new version in its manifest and a line in `extension-versions.json`
  (`check-see-extension` fails without both, and never lets a version already on main change).
- **Updating**: the reader picks the folder they loaded it from, once (`showDirectoryPicker`, the handle kept in IndexedDB; only a folder whose manifest
  has our key). Every file is fetched and proved against the list before anything is touched; all are swapped at the end, the manifest last; a swap
  that fails part of the way is put back. Then the extension is asked to `chrome.runtime.reload()`. By itself when the browser already lets the site
  write there on every visit (the keeper, 5 seconds after a page opens, and only where an extension answers), by one press when it doesn't.
- **What it costs, said once**: with the folder chosen, whoever controls debaser.site can change the extension's code; the fingerprints prove the
  files are the site's, not that the site is honest. The window says so where it asks. A list signed by a key kept off the site would be the next step.
- **Proved**: the writing, refusals and putting back (check); the window with real folder handles (`drive-see --only extension`, 13); a rewritten
  folder read again on the site's word, with its settings and sites kept (`drive-see-extension`, 39). **Not proved**: the browser's own folder box and
  its "on every visit" question, which no script can press. A new permission in the manifest may need the reader's OK in the browser.
- 0.1.0 doesn't know the word `reload`: after its first update the reader presses ↻ once.

## History, TRAIL and kept pages (Phase 5; on the site since Luke's yes to the tables, 2026-11-23)
- **History** (`history.ts`, `history-store.ts`): 90 days, 2,000 rows, under the account's own key in this browser; one key clears it. **TRAIL**
  (`trail.ts`): the same rows as a map of sites; the same walk always makes the same map.
- **KEEP PAGE**: `POST /api/see/keep` (`server/keep.ts`) looks at the page again, signed out, and answers with a card and a copy: scripts, frames and
  forms gone, sheets and shrunk pictures written into it, 10 MB at most, so it asks for nothing from anywhere. Files are held by addresses under a
  name made for that one copy, so a page can't write itself one. Not 200, or nothing but a sign-in: a card, no copy, private.
- **Where it is kept**: `supabase-pages-repository.ts` on the site, or `pages-repository.ts` (IndexedDB `debaser-seeing`) on a local dev server. The key
  says which: EVERYONE WILL SEE THIS, or ONLY YOU, IN THIS BROWSER.
- **Elsewhere on the site** (answer 13): Ctrl+K's PAGES, letters and recommendations (`page`), a board thread each (`page` anchor, TALKED ABOUT IN), MEDIA's
  PAGES lane and DISCOVER's by the tags their keepers gave (`KeptPagesLane`). A private page is in none of them.
- A copy opens at `see:kept/<id>` in the same frame with scripts off and no files, its source's link above it. Ctrl+K has PAGES.
- **On the site** (`NEXT_PUBLIC_SEEING_DATA_SOURCE=supabase`, migrations 20261123130000 to 130300): cards everyone reads, copies and notes for accounts,
  REPORT and a moderator's HIDE (`seen_hide`), history and tabs on the account (`account.ts`; in this browser too, so a line that is down loses nothing).
  Local dev keeps all of it in the browser. The visit record is written by `browse_log_write` with the reader's own session (`server/visits.ts`).

## MARGINALIA and GRAFFITI (Phase 6)
- `margins.ts`, `margins-store.ts`: notes on passages (300 characters, 50 a page) and strokes drawn over pages, under the account's own key in this
  browser (1.5 MB; the pages drawn on longest ago go first). **Notes**: a selection is told by the hook only while a panel wants one; a passage is marked with the browser's own highlights, so the page
  itself isn't changed. **Graffiti** stays where it was drawn as the page moves; READER has its own, since its words stand elsewhere. A page that lays itself out
  differently at another width moves under its drawing.
- Notes are the site's (`seen_notes`, `notes-store.ts`): everyone with an account who opens the page here sees them, with REPORT and HIDE. Drawings are
  this browser's.

## SEEN TOGETHER (Phase 6)
`together.ts` (pure), `together-store.ts`: `[ SHOW MY ROOM ]` tells the Room this reader is in (or their own) which page is in front and how far
down it is, on the room's private channel (`seeing:<room>`, migration 20261123130300; on a local dev server, between this browser's tabs). Nothing is
stored. What comes from the room is a stranger's words: an outside address only (`readTogether`), and a page opens only on the looker's own press
(`[ SEE TOGETHER ]` in BROWSER, `[ PAGE: … ]` in the Room's corner keys); `[ FOLLOW ]` moves the page already in front and nothing else. Each sees it
through their own lens. Sixty seconds without a word is nothing shown.

## SONIFY (Phase 6)
`sonify.ts` reads a page's tags in order (headings the beat, links the notes, pictures a bell) and writes BeepBox's own JSON into BEATBOX's address;
no word or address of the page goes in it. The same page always sounds the same.

## The extension's trial (2b, 2026-11-23, `scripts/see-extension-trial.cjs`, Edge 158)
A throwaway extension, pretend sites for the cookies, and the real list signed out (nobody was signed in to anything).

| Way | A site shows | Stays signed in (pretend site, Strict, Lax and plain cookies) | Its own scripts see their cookies and storage |
| --- | --- | --- | --- |
| (a) framed in a page of debaser.site, the no-framing header lifted for that frame | yes | **no, none sent** | no |
| (b) an ordinary tab, the lens put on it, the machine in the side panel | yes, always whole | **yes, all sent** | yes |
| (c) framed in a page of the extension's own, with leave for that site | yes | **yes, all sent** | no (storage starts empty in a frame) |

Real sites, words shown signed out (b is the site itself):

| Site | (b) tab | (c) extension's frame | (a) our frame |
| --- | --- | --- | --- |
| Wikipedia | 1601 | 1270 | 1281 |
| BBC News | 1842 | 1842 | 1842 |
| The Guardian | 3645 | 3645 | 3645 |
| Hacker News | 707 | 707 | 707 |
| GitHub | 518 | 518 | 518 |
| archive.org | 0 (draws itself where this count can't see) | 0 | 0 |
| old Reddit | 26 (turned a robot away) | 26 | 26 |
| Excalidraw | 79 | 74 | 74 |
| FT | 79 | 79 | 79 |
| YouTube | 283 | 57 | 57 |
| X | 399 | 399 | 369 |
| Instagram | 507 | 330 | 330 |

None broke out of its frame. What follows: **OWN EYE opens in the extension's own page (c), with the ordinary tab and side panel (b) one key
away** for sites that keep their sign-in in storage, or look thin in a frame (YouTube, Instagram). (a) is dropped: it lifts a site's protection
and still signs you out. Not tried: any site signed in, which only Luke can do with his own account; Chrome itself (only Edge is on SERVER).

## Proof
`npm run checks -- --only check-see` (attack list with 63 guards each watched failing, the rewriter and routes, the frame's documents, what
is drawn); `scripts/drive-see.cjs` (shell, frame, eye, lenses, extension, search, themes, one at a time with `--only`, on a local mock server); `scripts/see-attack-live.cjs` (once for real on
SERVER, 2026-11-23: 614 ways in refused, 6 real redirects into the house not followed, every socket opened was to a public address).

## The security review (2026-11-23, over 128b12a..d44b88c, a fresh reader told to break it)
Nothing in the fetch, the gate, the passes or the routes. Two in the frame, both letting a page reach another host from the reader's own
browser (never the site, the session or the house): WebRTC brought back by undermining the hook, and link hints, with scripts off too. Both
were proved in the drive first, then closed. Owed before `SEEING_OPEN=accounts`: Luke has looked, and the visit record's table.
