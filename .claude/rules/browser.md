---
paths:
  - "app/browser/**"
  - "app/api/see/**"
  - "app/api/extension/**"
  - "app/lib/seeing/**"
  - "app/components/seeing/**"
  - "app/components/SeeKey.tsx"
  - "extension/**"
  - "app/lib/web/safe-fetch.ts"
  - "app/lib/web/public-address.ts"
  - "scripts/*see*"
  - "docs/seeing-machine*.md"
  - "SPEC-seeing-machine.md"
---
<!-- Moved word for word from CLAUDE.md on 2026-11-27 (Luke's context system). It loads when a file in this area is opened. -->
## BROWSER, the DEBASER SEEING MACHINE (/browser; SPEC-seeing-machine.md; how it is built: docs/seeing-machine.md)
- A page is fetched because a reader asked to see it, then and there. That isn't scraping for the feed (the MEDIA rule), and it must never
  become it: no page is fetched by a job, no crawler, and none goes into `web_items`.
- What is kept: a capture they press for (KEEP PAGE), and OWN WEB (Luke, 2026-11-27, typed in the BROWSER session: "Yes, change it", to
  keeping every page he opens): pages the owner opens through the server's eye, kept on his account only, private, each as KEEP PAGE keeps a
  copy. Never a sign-in or a page that wasn't the page itself, never a form. Any page, any site, or everything can be deleted.
- OWN WEB also keeps the pages OWN EYE shows inside BROWSER (Luke, 2026-11-27: "Keep every page"; which pages never, 2026-11-28: "none"),
  for any account, behind a switch that is the EXTENSION's (`chrome.storage.local` `keep`): off for everybody, per browser, switched on
  only by two presses on the extension's own SITES page with the plain words, switched off from either side. The site can never switch
  it on, and the extension hands a page's words to nothing while it is off. The house's lines, whatever is kept: the page's visible
  words only (`visibleWords` in extension/worker.js), never the value of any box, a password, a hidden or one-time-code field, anything
  not drawn, cookies, storage or headers; only the one frame directly inside BROWSER's tab, never an ordinary tab, a frame inside a
  frame or a never-list page; private to that account; the page says it is being kept. A change to any of this re-runs
  `scripts/drive-see-own-frame.cjs` and its mutants `keepoff`, `boxes`, `nevertool` (each must fail), and changes /privacy in the same push.
- The only way to fetch any site is `safeFetchAnySite` (`app/lib/web/safe-fetch.ts`). SERVER sits beside everything in the house: a change to
  it, `public-address.ts`, `app/lib/seeing/server/` or the frame (`frame.ts`, `hook.ts`) runs `npm run checks -- --only check-see`, the drive
  (`scripts/drive-see.cjs`) and `scripts/see-attack-live.cjs`, and adds its guard to the attack list's MUTANTS.
- Never: a proxied sign-in page, a password box that works, anything that shows another site's sign-in as ours (D1); video or sound through
  the server; a page opened by a link alone (it waits for GO).
- The server's eye is the owner's account only until Luke opens it (`SEEING_OPEN`); `SEEING_MACHINE=off` shuts it at once.
