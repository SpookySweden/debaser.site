# BROWSER, the DEBASER SEEING MACHINE: how it is built

The plan and Luke's answers are `SPEC-seeing-machine.md`. This is what was built, what keeps it shut, and what works.

## Where things are
| What | Where |
| --- | --- |
| The page, tabs, keys, the frame's element | `app/browser/page.tsx`, `app/components/seeing/*` |
| Addresses, tabs, the frame's documents and messages, our script in it | `app/lib/seeing/address.ts`, `tabs.ts`, `frame.ts`, `hook.ts` |
| The status line: what was done, the eye, files and refused, the page's own size (PAGE 48 KB, decision 50), the lens, HTTP nnn at 400 and over, how long it took; one line, cut at the end when narrow | `SeeingMachine.tsx`, `took.ts` |
| The keyboard: / the box, Alt+N a new tab, Alt+W close it, Alt+1 to 8 a tab, Alt+L the next lens, Alt+H HISTORY, Alt+K KEPT, Alt+R ask again (as ↻), Escape puts them and the engines' list away (only while one is open; none while the page has the keyboard) | `app/lib/seeing/keys.ts`, listed on a new tab (`SeeingStart.tsx`) |
| A refusal said plainly: what it means, what may still be tried; every reason the server gives has its own words (a check reads them from its source; a file that isn't a page, "NOT SHOWN HERE: <type>", offers OPEN SOURCE only); under it the trace (EYE, ASKED, ANSWER and how long), only what this side knows | `app/lib/seeing/refusals.ts`, `SeeingRefused.tsx` |
| Which keys show: HISTORY and KEPT at the tab line's end, always; a new tab only SCAN besides; SEAM, LOUPE, ERASE greyed until a page is drawn; the page's own keys (KEEP PAGE and on) only for an outside page | `SeeingTools.tsx`, the tool row in `SeeingMachine.tsx` |
| Lenses, one file each | `app/lib/seeing/lenses/` |
| The server's eye from the browser | `app/lib/seeing/server-engine.ts` (asks `/api/see/*` and nobody else) |
| The server's eye | `app/lib/seeing/server/` (SERVER ONLY; `scripts/check-web-types.cjs` holds that), `app/api/see/*` |
| The guarded fetch | `safeFetchAnySite` in `app/lib/web/safe-fetch.ts`, its rules in `app/lib/web/public-address.ts`, its way out in `server/way-out.ts` |

## Settings (none needed; each read when a request arrives)
- `SEEING_MACHINE=off`: the server's eye off for everybody at once, pages already open included.
- `SEEING_OPEN=accounts`: opens it to everyone with an account (D2). Unset: the owner only (`SEEING_OWNER_ID`, else `SCREENS_OWNER_ID`).
  Luke's to set, and it opens nothing for anybody else until the visit record (D3) can be written (`server/visits.ts`, through `browse_log_write`; the `browse_log` table is in the live database since 2026-11-23).
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
   is a fresh window with it back) and no link element either (a stylesheet a page links to is a style that imports it), nor a meta it makes (a refresh would move the frame to a page its policy refuses: it is an inert see-meta). `createElement` and
   its kin are covered, every way of writing markup goes through one Trusted Types policy the browser enforces, and addresses that are
   scripts are refused. That part runs in the page's own window, so it leans on nothing the page could put something else in place of.
   `scripts/drive-see.cjs --only eye` tries about 70 ways (workers, worklets, beacons, fonts, a refresh, frames and links made every way a script can), then the same with each built-in taken from under it (the first version let 342
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
signed, `location` is pointed at a stand-in (the frame's own address can be neither read nor moved), and no frame tag is left in their words. A drawing's animation (SVG `set`, `animate`...) that sets an address, or whose values hold one, is taken out (`SMIL` in `rewrite.ts`). A frame is a link named by its host and path (a frameset's, a line each). A page that isn't HTML is drawn as what it is (`open.ts`): a picture, words, or a news feed as its list of links in plain text (`feed.ts`, decision 42). A feed a page names in its <link rel=alternate> is noted (`feeds`, three at most) and [ FEED ] opens it (decision 44). A page that builds itself and comes out with nothing on it (the hook's census at 4 and 10 seconds) gets a line saying so (`data-seeing-empty`, decision 43).

Pages that can't be drawn as they mean are said so over the top: one that builds itself and comes out empty (decision 43), one the site sent with nothing on it at all (`cameBlank`), and a site's check that a person is asking (Cloudflare's "Just a moment...", a CAPTCHA wall; `bot-check.ts`, decision 48), never answered, with OWN EYE and OPEN SOURCE named. Plain text, CSV and JSON are drawn as words, JSON laid out two spaces a level; a news feed as its list (decision 42).

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
| An address inside the house (localhost, 192.168.x, [::1], nas.local, a tailnet) | refused at the box, NOT A PUBLIC ADDRESS, before GO (decision 52) | | the server refuses it whatever the box says |
| An unusual port (example.com:8080) | the line under the box says the server asks only 80 and 443; GO shows the refusal, with OWN EYE (decision 51) | | |
| A PDF | refused: READ opens those | | |
| Small web (danluu.com) | whole | no main text (a list) | |
| Aozora (Shift_JIS) | whole | yes | |
| accounts.google.com | refused, always | | D1 |

## Lenses and tools (Phase 3)
One file each in `lenses/`; a lens is a stylesheet (`css`), what it needs done to the page (`tools`, acted on by `hook.ts`, each undone when the
next dressing doesn't ask for it), and a panel. X-RAY (a MADE OF row pointed at outlines its part of the page: `lit`, decision 45; pressed or reached by the keyboard it is brought into sight: the `reach` tool), LOW-FI (five palettes), DYE (colours to the theme's dyes, 4.5:1 kept, pictures dithered on a
canvas), GLASS (`html[data-see-glass]` clears the site window; the backgrounds run while it is on), CUSTOM (ten blocks, shared as `SEE:words+mono`).
SEAM and LOUPE are a second drawing of the page, clipped. ERASE keeps selectors of one shape (`isSelector`) per site; SITE MEMORY keeps a lens per
site (`memory.ts`, this browser only until Phase 5). TIME DIAL: the Internet Archive's copy nearest a year. SCAN: wiby.me's own random page. The lenses and the tools share their lines (`[data-seeing-keyrow]`). [ READ IT ] (`read-ref.ts`) opens an Open Library work, an Archive book reader, an Archive PDF/EPUB, or an Archive item's own page when the page drawn says it is texts, in the site's own reader at /read. A lens or SEAM/LOUPE/ERASE pressed while HISTORY, KEPT or the engines' list covers the page puts the cover away. A page tunes in as it arrives (`.seeing-arrive` in globals.css; none under reduced motion). An address with a #part (a plain id) opens at that part, through X-RAY's bring-into-sight (`partOf` in frame.ts), until the first X-RAY press; a link to a part of the same page moves there in the frame (the hook's `jump`).
Proof: `drive-see.cjs --only lenses` (DYE and GLASS measured on every theme, 5.51:1 or better).

## Media, SEE and the extension (Phase 4)
- **The tray** (`[ MEDIA n ]`): what a page plays or says it plays (`server/media.ts`; scripts' own additions by `hook.ts`), read by the Room's own rules
  (`lib/seeing/media.ts`, `recognizeLink`, `queueRefusal`). Rung 1 a platform's player, rung 2 a file or stream (a file is proved by
  `probeVideoLink` first), rung 5 its own page only, with the reason. Rung 3 (a page's declared player framed in the Room, NOT IN STEP) needs a new
  kind of queue row, so it waits for a database change; rung 4 waits for SCREENS' relay.
- **`[ SEE ]`** (`SeeKey`) beside outside links in posts, comms, letters, MEDIA's reading rows and a forum thread about a MEDIA item, for people whose bar has BROWSER on it.
- **The extension** (`extension/`, how to put it in: its README): OWN EYE. Its own page frames a site the reader has ADDED, with its cookies, in the
  theme the site told it; a panel beside an ordinary tab has the same lenses. It asks for no site when it is put in. The no-framing header is
  lifted by session rules that name the machine's tab (or BROWSER's, while held), for added sites, or every site once that is allowed, never
  a sign-in; they go when the page does (what they do to a page's headers: "ALLOW EVERY SITE" below). `Temp/check-see-extension.cjs`,
  `scripts/drive-see-extension.cjs` (pretend sites, signed in to nothing).

## OWN WEB (Luke, 2026-11-27: "Yes, change it", to keeping every page he opens; .claude/rules/browser.md)
- The server says which page may be kept (`ownWeb` on the document: the owner's eye, or the local drives' `dev`; status 200; not a page that is
  nothing but a sign-in). `own-web.ts` then keeps it as KEEP PAGE does, a copy made by the server's own look again, private, tagged OWN WEB, once a
  day per address. On the phase 5 tables (seen_pages, seen_page_copies, the seen store), so their rules hold: his alone, at most 200 a day.
- `[ OWN WEB n ]` beside KEPT (`SeeingOwnWeb`): find by words, filter by site, open the copy kept that day or the page now, delete a page, a site
  or everything (two presses), and switch keeping off (KEEPING WHAT I OPEN). KEPT, Ctrl+K and the lanes leave OWN WEB's pages out.
- Never kept: what OWN EYE shows (his own browser, signed in: the site never sees it), a sign-in, a page that wasn't the page itself, a form.
- Not built: the files on I: (the store is where the database keeps its files); other accounts (a switch of their own, off, when Luke asks).

## Sign-in groups, IMPORT, the first visit, the store (Luke, 2026-11-27)
- `SIGN_IN_GROUPS` (extension/sites.js): adding a site that shares a sign-in offers the whole company's sites, named before the press, in one box
  of the browser's (the machine's door, the panel's ADD); each stays removable on its own in SITES, which also has ADD A SIGN-IN.
- IMPORT FROM THIS BROWSER (SITES): the browser's `history` permission, optional, asked for on the press, used once to list site names from the last
  30 days (a company's sign-in first, ticked) and given back at once. Chosen over `cookies`, which would hand the extension every cookie's value
  and is what the store reviews hardest; the history gives names only. Nothing leaves the extension's page.
- The first visit (`SeeingFirstVisit`): what each eye is for, what each lets you do, and that the server's eye writes down which sites it opens,
  kept with no end date (D3), until UNDERSTOOD. The same is on /privacy, with the extension's own section.
- The Chrome Web Store: `docs/extension-store/` holds what to paste, the screenshots (1280 x 800, from `STORE_SHOTS=... drive-see-extension`) and
  exactly what Luke presses. The icon and the store's logo and tile are the word DEBASER as letters, made by `scripts/make-text-icon.cjs`
  (Luke, 2026-11-27: "generate a text icon for debaser"; his pick of the two: "Yellow square (Recommended)", Black on Daffodil). Nothing
  is his to draw for the listing.

## OWN EYE inside BROWSER's own tab (Luke, 2026-11-27: "not open in a new tab but inside a 'new tab' inside of debasers browser module")
- With the extension, OWN EYE shows the page in BROWSER's tab, in a frame on debaser.site (`SeeingOwnFrame`), sandboxed so it can't move or read
  the page (`OWN_FRAME_SANDBOX`: no top navigation). BROWSER holds itself open to the extension while it is drawn (`holdOwnEye`, a port); the
  extension lifts an added site's no-framing rule for frames in that tab only, and lets go when the page does. `frame.js` tells it where a framed
  page got to, and it tells that tab's BROWSER page alone.
- **Signed in where the site allows it here**: a framed page is sent only the cookies a site marks for use inside other sites (SameSite=None).
  Google's are, so YouTube can be; many sites' aren't, and are signed out here. The extension does not copy or loosen a site's cookies to get
  round that: it would weaken them everywhere. IN A TAB and IN THE MACHINE are one press away, and a page that says nothing in 8 seconds is said not
  to have shown here.
- A YouTube video is YouTube's own player (`/embed/`): its watch page stops itself in a frame (the white page). Sign-in pages are never framed (D1).
- **A video clicked inside the frame** (Luke, 2026-11-27: "shorts will play but clicking a video will return a white page"; extension 0.8.1):
  the click moves the frame to YouTube's watch page, often with no new page loaded, so `frame.js` looks twice a second and tells each new
  address once; told of a `/watch` page (`watchPageOf`), `SeeingMachine` makes that video the tab's next stop, and YouTube's own player
  takes over (BACK returns). Heard only when youtube.com is on the extension's list, or every site is allowed: without either nothing in
  the player can speak, the click still goes white, and pasting the video's address is the way. Proved on pretend sites
  (`drive-see-own-frame`: an address pushed inside one page is told; `drive-see --only owneye`: told of a watch page, the player is put
  there); not on real YouTube.
- **Every key on the extension's own pages has hover words** (the same morning: "hovering over any buttons gives a detailed explaination of the
  function and purpose"; 0.8.1): a plain `title`, always on, since the site's `[ EXPLAIN ]` switch can't reach an extension's page
  (`LENS_WORDS`, `KEY_WORDS` in act.js; the rest in machine.html and panel.html). Its way to the server's eye reads
  `[ SERVER EYE: SIGNED OUT, ON DEBASER.SITE ↗ ]`.
- **No ADD key that leads nowhere** (0.8.1): BROWSER's `[ ADD youtube.com ]` opens the machine's page, which sends YouTube, X, Instagram,
  Facebook and TikTok to a tab; that page now has the ADD key under its OPEN IT IN A TAB (the site, or its whole sign-in group), and once the
  site may be shown says so and offers no ADD.
- Proved with real cookies on pretend https sites: `scripts/drive-see-own-frame.cjs` (by name, and with every site allowed); BROWSER's
  side: `drive-see --only owneye`.
- The address box follows it (2026-11-27): where the extension says the framed page got to (an http(s) address only) is put in the box,
  without reloading the frame; GO there makes it a stop of the tab's own. YouTube's player reads as its watch page (`boxAddress`).
- Lenses on it (2026-11-27): a lens pressed in BROWSER is sent over the held port; the extension wears it on the framed page (act.js putLens
  on that tab's frame) and again on each page the frame goes to. READER, X-RAY, LOW-FI and DYE (its YOUR THEME); WATCHERS, GLASS and CUSTOM are the
  house's only and say so. Nothing of the page leaves the reader's browser; they stay signed in.
- The eyes say their purpose: OWN EYE "your browser, signed in as you"; SERVER EYE "from the house, never signed in, rebuilt through the lenses".
- **Every key named OWN EYE shows the page here** (Luke, 2026-11-27: "it seems own eye still opens a new tab in edge when i click it"), whichever
  eye is the choice: the switch's OWN EYE key (below), a refused page's `[ SHOW IT WITH OWN EYE: YOUR BROWSER ]`, SHOW IT HERE WITH OWN EYE:
  YOUR BROWSER, SIGNED IN on the "needs your own browser" page, and words to an engine marked ↗ (with the extension in; without it, a tab of
  the browser's as before). `SeeingMachine`'s `there` holds the addresses asked for that way, for this visit; `[ FROM THE HOUSE ]` is the way
  back for one page.
- **The eye switch is one control with both eyes** (Luke, 2026-11-27: "make it clearer between own and eye server eye, these need to really
  state their purpose better"): `THIS PAGE THROUGH: [ OWN EYE: YOUR BROWSER, SIGNED IN ] [ SERVER EYE: THE HOUSE, SIGNED OUT ]`. The eye
  showing the page in front is the one drawn pressed (`showing`; a site the house can't show is still the server's eye in front, saying so).
  A press on the other shows this page through it, here, and is the choice for the pages opened next (`throughOwn`, `throughServer`).
  Without the extension the first key reads `[ GET OWN EYE: YOUR BROWSER, SIGNED IN ]` and opens the EXTENSION window. It replaced a single
  key that named the eye that was on while a press switched away from it, beside a second key named `[ OWN EYE ]`.
- **What works on a page OWN EYE shows, said on the page** (the same morning: "so that the lesnes work while people are still able to be signed
  in"): one line under the tool row (`data-seeing-own-tools`) says only the lenses reach it, on a site that was added, and that the other
  tools on the row (NOTES, GRAFFITI, SEARCH THIS, SCRIPTS OFF, SHOW MY ROOM, SEAM, LOUPE, ERASE, MEDIA, SONIFY) need the house's copy, which
  `[ FROM THE HOUSE ]` shows. It says what the tools need, not what the site can never do, so it stays true when OWN WEB keeps OWN EYE's
  pages (decision 61). A lens pressed while the site is not on the list (YouTube's player shows without that) says
  `A LENS NEEDS <site> ADDED FIRST` instead of doing nothing. A tab of the browser is opened only by a key whose name says tab: `[ IN A TAB ↗ ]` (on the frame's line,
  and on the "needs your own browser" page) and `LOG IN TO YOUTUBE IN A TAB ↗` (a sign-in page is never framed, D1). A framed page that says
  nothing in 8 seconds says why (the site refuses to be inside another, or it is a sign-in page) and its tab key becomes OPEN IT IN A TAB ↗, the
  main key. `drive-see --only owneye` (its last steps fail on the old machine file: the key opened a tab).

## ALLOW EVERY SITE, and what the frame rule does to a page's headers (extension 0.8.1)
Luke, 2026-11-27, to "may it be allowed on every site in one press, instead of adding each site one at a time": "One optional key
(Recommended)" (decision 60). 2026-11-28, on sites that only show with their script-safety rules off: "Keep your default" (decision 67).
- **The key**: SITES on the extension's own page has `[ ALLOW EVERY SITE ]` (off until pressed; the browser's own box asks; `[ TAKE IT BACK ]`
  undoes it and leaves the sites added by name). BROWSER's "not on the list" panel has `[ ALLOW EVERY SITE ↗ ]`, which opens that page
  (`openOwnEyeSites`, the `sites` message): only the extension's own page, on a press there, can ask the browser. With it on, the tool row
  reads `[ ✓ EVERY SITE IS ALLOWED ]` for a site not added by name. The extension still answers the site yes or no for the one page asked
  of (`has`: `{ on, site, named }`), never the list.
- **What stays as it was**: sign-in pages, banks and payments are never framed (`NEVER_HOSTS`, `NEVER_NAMES`, the never-paths), allowed or
  not; YouTube, X, Instagram, Facebook and TikTok still open in a tab from the machine's page (`TAB_SITES`); nothing is lifted unless
  BROWSER's page (or the machine's) holds that tab open to the extension, and only for frames in that tab.
- **Three kinds of page** (`frameRule` in worker.js; rules matched on the response's own headers):
  1. Refused by `X-Frame-Options` alone: that header is removed and one policy of ours is added beside the site's own. Its own policy,
     script-safety rules and all, is kept whole.
  2. A `Content-Security-Policy` that is only about framing (`frame-ancestors` and nothing in `PROTECTS`): replaced by ours.
  3. A policy that mixes its no-framing line with script-safety rules (`script-src` and the like): replacing it switches those rules off
     while the page is inside BROWSER. That is done ONLY for a site added by name, and ADD says so wherever it is offered (`NAMED_COST`,
     the same words in act.js and `SeeingOwnFrame`). Under EVERY SITE alone such a page is left whole and does not show; BROWSER says
     IT DIDN'T SHOW HERE and offers a tab or `ADD <site> BY NAME ↗`.
- **Ours** (`framedBy` in sites.js): `frame-ancestors 'self' https://debaser.site chrome-extension://<id>`, plus the sites added by name
  (the first 100) for a site added by name. So a page shown here can't put a third, refusing site inside itself with that site's
  protection gone (before 0.8.1 the rule only named who asked, and a framed page could); one added site inside another still shows.
- **The few lines on every page**: with every site allowed, `frame.js` is registered for every site, so it runs in every tab of the
  browser. Its first line asks whether the page is directly inside a debaser.site page or the machine; anywhere else it returns, reading
  and sending nothing. Proved in an ordinary tab and in a frame inside an ordinary tab (`drive-see-own-frame`).
- **Only BROWSER's own frame is answered for** (0.8.1, the coordinator, 2026-11-28; before it, `frame.js` spoke from any frame directly
  inside any debaser.site page, so with YouTube added the floating player on /browser could report its address and take the lens). Inside
  a debaser.site page `frame.js` posts `{ see: 'own-eye?' }` to its parent and begins telling only when the parent posts back
  `{ see: 'own-eye' }` (from `window.parent`, origin debaser.site). `SeeingOwnFrame` answers only when the asker is its own iframe's
  window. In the machine's page (the extension's own) it begins at once: that page has one frame. The word is no secret: a page on the
  site that answered falsely would only let a frame it made itself be followed, and the worker still drops it unless BROWSER's page holds
  that tab. Proved: `drive-see-own-frame` (an embed beside the OWN EYE frame is drawn, says nothing, gets no lens; `--mutant anyframe`
  fails), `drive-see` owneye (the real `SeeingOwnFrame` says yes to its frame and nothing to another).
- **A reading of 20 well-known sites' front pages, 2026-11-28, signed out (a signed-in page may differ)**: kind 3 (need adding by name):
  DuckDuckGo, GitHub, BBC, Stack Overflow, LinkedIn, Hacker News, Spotify. Kind 1 (shown under EVERY SITE, their policy kept): Reddit,
  Twitch, Discord, Google search, Gmail, the Guardian, the New York Times, Netflix. No no-framing rule at all: Wikipedia, Amazon, IMDb and
  the rest. A site that stops itself in a frame by script, or whose sign-in is not sent inside another site, is no different than before.
- **Not driven**: the browser's own box and its words (a script can't press it; the drives use a copy of the extension that already holds
  the leave), and that TAKE IT BACK leaves the named sites. Real sites.

## Signed in by default, as in Chrome or Edge (Luke, 2026-11-27)
- **An ordinary tab** of the reader's own browser (`openTab` in the extension's worker; since decision 55 only behind a key whose name says tab),
  with the machine's lenses in its side panel
  (opened by itself where the browser lets it; its key in the bar always does). Tabs, back and forward, sign-ins, video, passwords and downloads
  are the browser's own, because they are. The machine's own page (its frame) stays, one press away (IN THE MACHINE), for the lenses that need
  it, and ADD THIS SITE opens it, since that is where a site is added. An ordinary tab needs no site on the list.
- **Why the tab**: YouTube's videos played white in the machine's frame (Luke, 2026-11-27); its pages stop themselves in a frame. In a tab they are
  YouTube as the browser shows it. The machine's page sends YouTube, X, Instagram, Facebook and TikTok to a tab (`TAB_SITES` in sites.js).
- **Without the extension** BROWSER asks for it first, once a visit (`SeeingGetSignedIn`); a browser that can't have it is told so. The server's eye
  says plainly that YouTube and those sites need your own browser (`shells.ts`, `SeeingShell`) and asks the server nothing for them, unless SHOW
  WHAT COMES ANYWAY is pressed: they draw themselves with scripts a signed-out server isn't given enough for, and videos never pass through it.
- BROWSER's own page doesn't follow the tab once it is open: that would take the browser's `tabs` leave, which reads every tab's address.

## OWN EYE first, the sign-in offered on YouTube, ADD THIS SITE (Luke, 2026-11-23)
- With the extension, a page pressed for opens in OWN EYE, your own browser, in a tab of its own (`SeeingElsewhere`), with SEE IT HERE for the
  server's eye; a page that was only open when BROWSER loaded waits for a press. `[ OPENS IN: OWN EYE | SERVER EYE ]` switches it, remembered in this
  browser (`eye-choice.ts`). Without the extension, the server's eye as before.
- On entering a page of a site in `SIGN_IN_OFFERED` (`youtube.com`, for now) that is not on the extension's list: LOG IN TO YOUTUBE IN A TAB ↗, NOT NOW (this
  page), DON'T ASK AGAIN (that site, for this account in this browser). Without the extension: GET THE EXTENSION first.
- `[ ADD youtube.com ]` / `[ ✓ ON THE LIST: youtube.com ]` beside OWN EYE, and ADD in the extension's panel. The site asks the extension (`has`)
  about the page in front only, and it answers for a few sites at most, so the list can't be gone through.
- **What it takes, said plainly**: only the extension can ask the browser for a site, and only from its own page, on a press there. So LOG IN and ADD
  from the site are one press here, one press on ADD in OWN EYE's page, and the browser's own box; in the extension's panel, one press and the box.
  Signing in itself is always on the site's own page in an ordinary tab (D1). The browser's box can't be pressed by a script: not driven.

## Search (Luke, 2026-11-23: "a list of multiple search engines such as Google, bing and your best ideas")
- `search.ts` (pure), `search-store.ts`, `SeeingEngines.tsx`. Words that are not an address go to the chosen engine; a line under the box says which of
  the two GO will do. Letters first ask an engine once (`w fog`, `!g fog`); `!` shows the list; ALL asks three, a tab each; a results page offers the
  same words of the others (ASK); SEARCH THIS takes a selection. An engine can be off, moved, or added by hand (https, one `%s`, no inside names). A new tab lists the engines that are on to read (name and letters); their keys wait behind [ ARRANGE ] (decision 49); the list from the box is always whole.
- Results are a page like any other: shown through a lens, never read into anything of ours. A bot check or a consent wall is never worked round: such
  an engine opens here in OWN EYE (the frame), or without the extension in a new tab (↗). READER shows a list of results as a list.
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
- **History** (`history.ts`, `history-store.ts`): 90 days, 2,000 rows, under the account's own key in this browser; one key clears it. Pages
  OWN EYE shows are rows too (2026-11-27, Luke: "use it like they would chrome or edge"): the address and title the extension reports (a
  video in YouTube's own player as soon as it is asked for), marked `own`. Since 2026-11-28 (Luke: "On the account too", decision 64)
  they go to the account like the rest, by address and title, read by that account alone and emptied by CLEAR: each is noted `told`, and
  `forAccount` sends a told row (the rows and the "own history" rule that were there already; no database change). The table has no
  column for the mark, so `asHere` puts OWN EYE back on a row in the browser that showed it; on another device it reads as any row. A row
  OWN EYE showed before that (own, not told) stays where it was, marked OWN EYE · KEPT IN THIS BROWSER ONLY, and is never sent. **TRAIL**
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
