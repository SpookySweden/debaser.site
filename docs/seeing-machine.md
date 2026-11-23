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
3. **WebRTC** is the one thing no policy in Chrome or Edge stops (the `webrtc` directive is not read there). The hook takes it away, and
   keeps it away by letting no frame be made (a frame is a fresh window with it back): `createElement` and its kin are covered, and every
   way of writing markup goes through one Trusted Types policy, which the browser enforces. `scripts/drive-see.cjs --only eye` tries 24 ways.
   Firefox has no Trusted Types in older versions: there the wrappers alone hold. Workers, sockets and the rest are the policy's.
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

The extension's column is Phase 4's (the trial, 2b, below when it is done).

## Proof
`npm run checks -- --only check-see` (attack list with 52 guards each watched failing, the rewriter and routes, the frame's documents, what
is drawn); `scripts/drive-see.cjs` (shell, frame, eye, themes, on a local mock server); `scripts/see-attack-live.cjs` (once for real on
SERVER, 2026-11-23: 614 ways in refused, 6 real redirects into the house not followed, every socket opened was to a public address).
