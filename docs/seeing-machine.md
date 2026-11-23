# BROWSER, the DEBASER SEEING MACHINE: how it is built

The plan and Luke's answers are `SPEC-seeing-machine.md`. This is what was built, what keeps it shut, and what works.

## Where things are
| What | Where |
| --- | --- |
| The page, tabs, keys, the frame's element | `app/browser/page.tsx`, `app/components/seeing/*` |
| Addresses, tabs, the frame's documents and messages, our script in it | `app/lib/seeing/address.ts`, `tabs.ts`, `frame.ts`, `hook.ts` |
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
`npm run checks -- --only check-see` (attack list with 52 guards each watched failing, the rewriter and routes, the frame's documents, what
is drawn); `scripts/drive-see.cjs` (shell, frame, eye, themes, on a local mock server); `scripts/see-attack-live.cjs` (once for real on
SERVER, 2026-11-23: 614 ways in refused, 6 real redirects into the house not followed, every socket opened was to a public address).

## The security review (2026-11-23, over 128b12a..d44b88c, a fresh reader told to break it)
Nothing in the fetch, the gate, the passes or the routes. Two in the frame, both letting a page reach another host from the reader's own
browser (never the site, the session or the house): WebRTC brought back by undermining the hook, and link hints, with scripts off too. Both
were proved in the drive first, then closed. Owed before `SEEING_OPEN=accounts`: Luke has looked, and the visit record's table.
