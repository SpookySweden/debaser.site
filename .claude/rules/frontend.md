---
paths:
  - "app/**/*.tsx"
  - "app/**/*.css"
  - "app/lib/ui/**"
  - "app/theme/**"
  - "docs/design.md"
  - "docs/theming.md"
---
# Pages, windows and components

Read `docs/design.md` before any UI work.

## How the site behaves
Guidelines that came from real bugs. Bend them if there's a good reason, but tell me.
- **The top bar's pages are called modules** (Luke, 2026-11-06). The list is `app/lib/ui/modules.ts`; each person ticks which appear and picks each one's hover colour in the MODULES window, saved to their account. A new one goes in that list, and `startsOn` says if it's on the bar for a first visit. An unticked module's address still works.
- **The board (`/forum`) is the desktop.** The arcade and the reader's own music (MY MUSIC) are windows drawn in `app/layout.tsx`, not pages; don't add a `/games` route back. A window opens from an address (`/forum?arcade=1`, `?music=1`, `?invite=<id>`, `?challenge=<userId>&game=<gameId>`), built and read in one place per window (`app/lib/games/arcade-window.ts`, `app/lib/audio/music-window.ts`). The one exception, Luke's decision on 2026-10-24 (SPEC-media-catalogue.md): the music *archive* is a page again, as the AUDIO tab of the FILES catalogue at `/files` (it was `/media` until 2026-11-04), because the catalogue lists every file the site holds and is a place a reader goes.
- **Windows don't re-render the page.** Each window's state lives in a small store (`app/lib/ui/window-slot.ts`) that only that window reads.
- **A window with unsaved work asks before it closes** (the customiser; see `app/lib/profile/unsaved-changes.ts`).
- **Starting something from the board takes two presses**: one to open, one to commit.
- **Reveals take their space in both states.** Anything that appears on hover, focus or tap must not move what you're pointing at or push other content around. Either position it absolutely, or reserve its box and swap only what's inside. Never turn a `hidden` element visible on hover inside a row. A keyboard reveal uses `:focus-visible`, never `:focus-within`, because a mouse click leaves focus behind and the panel stays stuck open.
- **Colours and sizes come from the tokens.** Every value lives in `app/theme/tokens.css`, `app/theme/fonts.ts` and `app/lib/ui/themes.ts` (`docs/theming.md`); components ask for names (`text-label`, `bg-paper`, `border-line`) and `npm run tokens` refuses raw values. Text must stay readable (4.5:1 contrast) in every theme. Motion stops under `prefers-reduced-motion`.
- **A video is never drawn in its row** (SPEC-floating-player.md). A cross-origin iframe restarts if it moves in the page, so a row calls `playFloating` and draws a `PlayerBox`; the one layer in `app/layout.tsx` (`FloatingPlayer.tsx`) holds the player, over the box or floating. A stream room keeps its own player and floats by its box going `position: fixed` where it stands.
- **A profile shows a person, not a console**: no ids, counts or settings read back at visitors.

## Also
- Phones currently get the desktop zoomed out (a fixed 1280px viewport in `app/layout.tsx`, Luke's decision 2026-11-02) until a real phone design exists. Keep the narrow layout from breaking anyway: every screen works at phone width with no sideways scroll. Prove visual changes with `npm run shot` at desktop and phone width.
- No colour values, fixed Tailwind palette colours (`text-red-500`, `border-black`, `bg-[#...]`) or bracketed sizes (`text-[13px]`, `py-[2px]`) in new code: `npm run tokens` fails on them.
- `'use client'` only on components that need state, effects or browser APIs.
