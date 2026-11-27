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
- A page is fetched because a reader asked to see it, then and there, and nothing of it is kept but a capture they press for. That isn't
  scraping for the feed (the MEDIA rule above), and it must never become it: no page is fetched by a job, and none goes into `web_items`.
- The only way to fetch any site is `safeFetchAnySite` (`app/lib/web/safe-fetch.ts`). SERVER sits beside everything in the house: a change to
  it, `public-address.ts`, `app/lib/seeing/server/` or the frame (`frame.ts`, `hook.ts`) runs `npm run checks -- --only check-see`, the drive
  (`scripts/drive-see.cjs`) and `scripts/see-attack-live.cjs`, and adds its guard to the attack list's MUTANTS.
- Never: a proxied sign-in page, a password box that works, anything that shows another site's sign-in as ours (D1); video or sound through
  the server; a page opened by a link alone (it waits for GO).
- The server's eye is the owner's account only until Luke opens it (`SEEING_OPEN`); `SEEING_MACHINE=off` shuts it at once.
