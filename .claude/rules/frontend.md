---
paths:
  - "app/**/*.tsx"
  - "app/**/*.css"
  - "app/lib/ui/**"
  - "docs/design.md"
---
# Pages, windows and components

Read `docs/design.md` before any UI work.

## How the site behaves
Guidelines that came from real bugs. Bend them if there's a good reason, but tell me.
- **The board (`/forum`) is the desktop.** The arcade and the music archive are windows drawn in `app/layout.tsx`, not pages; don't add `/games` or `/music` routes back. A window opens from an address (`/forum?arcade=1`, `?music=1`, `?invite=<id>`, `?challenge=<userId>&game=<gameId>`), built and read in one place per window (`app/lib/games/arcade-window.ts`, `app/lib/audio/music-window.ts`).
- **Windows don't re-render the page.** Each window's state lives in a small store (`app/lib/ui/window-slot.ts`) that only that window reads.
- **A window with unsaved work asks before it closes** (the customiser; see `app/lib/profile/unsaved-changes.ts`).
- **Starting something from the board takes two presses**: one to open, one to commit.
- **Reveals take their space in both states.** Anything that appears on hover, focus or tap must not move what you're pointing at or push other content around. Either position it absolutely, or reserve its box and swap only what's inside. Never turn a `hidden` element visible on hover inside a row. A keyboard reveal uses `:focus-visible`, never `:focus-within`, because a mouse click leaves focus behind and the panel stays stuck open.
- **Colours come from the theme.** The palette tokens live in `app/globals.css` and are applied through `app/lib/ui/controls.ts` and `app/lib/ui/themes.ts`; components don't write their own hex values. Text must stay readable (4.5:1 contrast) in every theme. Motion stops under `prefers-reduced-motion`.
- **A profile shows a person, not a console**: no ids, counts or settings read back at visitors.

## Also
- Every screen works at phone width with no sideways scroll. Prove visual changes with `npm run shot` at desktop and phone width.
- No colour values or fixed Tailwind palette colours (`text-red-500`, `bg-[#...]`) in new code: colours come from the theme tokens.
- `'use client'` only on components that need state, effects or browser APIs.
